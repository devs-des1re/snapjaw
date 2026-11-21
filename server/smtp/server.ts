import { SMTPServer, type SMTPServerAddress, type SMTPServerAuthentication, type SMTPServerSession } from "smtp-server";
import type { Readable } from "node:stream";
import { findSmtpCredential, touchSmtpCredential } from "../../db/queries/credentials";
import { getNumberSetting } from "../../db/queries/settings";
import { recordAudit } from "../../db/queries/audit";
import { verifyPassword } from "../../lib/passwords";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import { acceptMime, checkRecipient, checkSender, type Rejection, type Sender } from "../outbound/accept";
import { certificate, sniCallback } from "../tls/certs";
import { authFailures } from "./limits";

type SmtpError = Error & { responseCode?: number };

function smtpError(rejection: Pick<Rejection, "smtpCode" | "enhanced" | "message">): SmtpError {
  const error = new Error(`${rejection.enhanced} ${rejection.message}`) as SmtpError;
  error.responseCode = rejection.smtpCode;
  return error;
}

function senderOf(session: SMTPServerSession): Sender | null {
  return (session.user as unknown as Sender | undefined) ?? null;
}

async function readStream(stream: Readable, limit: number): Promise<{ data: Buffer; exceeded: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) exceeded = true;
    else chunks.push(buffer);
  }
  return { data: Buffer.concat(chunks), exceeded: exceeded || Boolean((stream as Readable & { sizeExceeded?: boolean }).sizeExceeded) };
}

async function handleAuth(auth: SMTPServerAuthentication, session: SMTPServerSession): Promise<Sender> {
  const ip = session.remoteAddress;
  if (authFailures.blocked(ip)) throw smtpError({ smtpCode: 421, enhanced: "4.7.0", message: "Too many failed logins from your address. Try again in 15 minutes." });
  const username = String(auth.username ?? "").trim();
  const credential = username ? await findSmtpCredential(username) : undefined;
  const valid = await verifyPassword(String(auth.password ?? ""), credential?.passwordHash);
  if (!credential || !valid) {
    authFailures.fail(ip);
    await recordAudit({ email: username || null, ip, userAgent: "smtp" }, "smtp.auth_failed", username || null);
    throw smtpError({ smtpCode: 535, enhanced: "5.7.8", message: "Username and password not accepted." });
  }
  authFailures.clear(ip);
  await touchSmtpCredential(credential.id);
  return { id: credential.id, kind: "smtp", allowedSenders: credential.allowedSenders, ratePerHour: credential.ratePerHour };
}

async function build(secure: boolean, maxBytes: number) {
  const cert = await certificate();
  const config = env();
  return new SMTPServer({
    secure,
    key: cert.key,
    cert: cert.cert,
    SNICallback: sniCallback,
    name: config.smtpHostname,
    banner: "Snapjaw submission",
    authMethods: ["PLAIN", "LOGIN"],
    allowInsecureAuth: false,
    authOptional: false,
    disabledCommands: secure ? ["STARTTLS"] : [],
    size: maxBytes,
    maxClients: 100,
    socketTimeout: 120_000,
    closeTimeout: 30_000,
    logger: false,
    onAuth(auth, session, callback) {
      handleAuth(auth, session).then(
        (user) => callback(null, { user: user as never }),
        (error: SmtpError) => callback(error),
      );
    },
    onMailFrom(address: SMTPServerAddress, session, callback) {
      const sender = senderOf(session);
      if (!sender) return callback(smtpError({ smtpCode: 530, enhanced: "5.7.0", message: "Authenticate first." }));
      checkSender(sender, address.address).then(
        (problem) => callback(problem ? smtpError(problem) : undefined),
        (error: Error) => callback(error),
      );
    },
    onRcptTo(address: SMTPServerAddress, session, callback) {
      if (session.envelope.rcptTo.length >= 50) return callback(smtpError({ smtpCode: 452, enhanced: "4.5.3", message: "Too many recipients. Resend accepts at most 50 per message." }));
      checkRecipient(address.address).then(
        (problem) => callback(problem ? smtpError(problem) : undefined),
        (error: Error) => callback(error),
      );
    },
    onData(stream, session, callback) {
      const sender = senderOf(session);
      readStream(stream, maxBytes)
        .then(async ({ data, exceeded }) => {
          if (!sender) throw smtpError({ smtpCode: 530, enhanced: "5.7.0", message: "Authenticate first." });
          if (exceeded) throw smtpError({ smtpCode: 552, enhanced: "5.3.4", message: `The message is larger than the ${maxBytes} byte limit.` });
          const result = await acceptMime({
            raw: data,
            envelopeFrom: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
            envelopeTo: session.envelope.rcptTo.map((entry) => entry.address),
            sender,
            source: secure ? "smtps" : "smtp",
          });
          if (!result.ok) throw smtpError(result);
          logger.info(`Accepted ${result.id} for ${session.envelope.rcptTo.length} recipient(s)${result.held ? ", held for quota" : ""}`);
          return result.held ? `Queued as ${result.id}. Held until the Resend quota resets.` : `Queued as ${result.id}`;
        })
        .then(
          (message) => callback(null, message),
          (error: SmtpError) => {
            if (!error.responseCode) logger.error(`SMTP data handling failed: ${error.message}`);
            callback(error.responseCode ? error : smtpError({ smtpCode: 451, enhanced: "4.3.0", message: "Temporary problem storing the message. Try again." }));
          },
        );
    },
  });
}

type Running = { servers: SMTPServer[] };

const store = globalThis as typeof globalThis & { __snapjawSmtp?: Running };

export async function startSmtp() {
  if (store.__snapjawSmtp) return;
  const config = env();
  const maxBytes = await getNumberSetting("limits.maxMessageBytes");
  const submission = await build(false, maxBytes);
  const smtps = await build(true, maxBytes);
  for (const server of [submission, smtps]) {
    server.on("error", (error: Error) => logger.error(`SMTP server error: ${error.message}`));
  }
  await new Promise<void>((resolve) => submission.listen(config.smtpSubmissionPort, "0.0.0.0", () => resolve()));
  await new Promise<void>((resolve) => smtps.listen(config.smtpsPort, "0.0.0.0", () => resolve()));
  store.__snapjawSmtp = { servers: [submission, smtps] };
  logger.info(`SMTP submission listening on ${config.smtpSubmissionPort} (STARTTLS) and ${config.smtpsPort} (TLS)`);
}

export async function stopSmtp() {
  const running = store.__snapjawSmtp;
  if (!running) return;
  await Promise.all(running.servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  store.__snapjawSmtp = undefined;
}
