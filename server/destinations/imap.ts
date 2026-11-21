import { ImapFlow } from "imapflow";
import type { ImapConfig } from "../../db/queries/destinations";

function client(config: ImapConfig) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

async function withClient<T>(config: ImapConfig, fn: (imap: ImapFlow) => Promise<T>): Promise<T> {
  const imap = client(config);
  imap.on("error", () => undefined);
  await imap.connect();
  try {
    return await fn(imap);
  } finally {
    await imap.logout().catch(() => imap.close());
  }
}

export async function testImap(config: ImapConfig): Promise<string> {
  return withClient(config, async (imap) => {
    const status = await imap.status(config.mailbox, { messages: true });
    return `Connected. ${config.mailbox} holds ${status ? (status.messages ?? 0) : 0} messages.`;
  });
}

export async function imapHasMessage(config: ImapConfig, messageId: string): Promise<boolean> {
  return withClient(config, async (imap) => {
    const lock = await imap.getMailboxLock(config.mailbox);
    try {
      const found = await imap.search({ header: { "message-id": messageId } }, { uid: true });
      return Array.isArray(found) && found.length > 0;
    } finally {
      lock.release();
    }
  });
}

export async function imapAppend(config: ImapConfig, raw: Buffer, date: Date | undefined): Promise<void> {
  await withClient(config, async (imap) => {
    await imap.append(config.mailbox, raw, [], date);
  });
}
