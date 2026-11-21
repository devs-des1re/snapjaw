import { Readable } from "node:stream";
import { google } from "googleapis";
import { getSetting } from "../../db/queries/settings";
import type { GmailConfig } from "../../db/queries/destinations";
import { env } from "../../lib/env";

export const gmailScopes = ["https://www.googleapis.com/auth/gmail.insert", "https://www.googleapis.com/auth/gmail.readonly"];

export function oauthRedirectUri() {
  return `${env().publicUrl}/api/destinations/gmail/callback`;
}

export async function oauthClient() {
  const clientId = await getSetting("google.clientId");
  const clientSecret = await getSetting("google.clientSecret");
  if (!clientId || !clientSecret) throw new Error("Add a Google OAuth client ID and secret under Settings first.");
  return new google.auth.OAuth2(clientId, clientSecret, oauthRedirectUri());
}

export async function authUrl(state: string, codeChallenge: string, loginHint?: string) {
  const auth = await oauthClient();
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: gmailScopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as never,
    login_hint: loginHint,
  });
}

export async function exchangeCode(code: string, verifier: string) {
  const auth = await oauthClient();
  const { tokens } = await auth.getToken({ code, codeVerifier: verifier });
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove Snapjaw's access at myaccount.google.com/permissions and connect again.");
  auth.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  return { refreshToken: tokens.refresh_token, email: profile.data.emailAddress ?? "" };
}

async function gmailFor(config: GmailConfig) {
  const auth = await oauthClient();
  auth.setCredentials({ refresh_token: config.refreshToken });
  return google.gmail({ version: "v1", auth });
}

export async function testGmail(config: GmailConfig): Promise<string> {
  const gmail = await gmailFor(config);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return `Connected to ${profile.data.emailAddress}. ${profile.data.messagesTotal ?? 0} messages in the mailbox.`;
}

export async function gmailHasMessage(config: GmailConfig, messageId: string): Promise<boolean> {
  const gmail = await gmailFor(config);
  const id = messageId.replace(/^<|>$/g, "");
  const result = await gmail.users.messages.list({ userId: "me", q: `rfc822msgid:${id}`, includeSpamTrash: true, maxResults: 1 });
  return (result.data.messages?.length ?? 0) > 0;
}

export async function gmailImport(config: GmailConfig, raw: Buffer): Promise<string> {
  const gmail = await gmailFor(config);
  const result = await gmail.users.messages.import({
    userId: "me",
    internalDateSource: "dateHeader",
    neverMarkSpam: false,
    processForCalendar: false,
    requestBody: { labelIds: config.labelIds.length ? config.labelIds : ["INBOX", "UNREAD"] },
    media: { mimeType: "message/rfc822", body: Readable.from(raw) },
  });
  return result.data.id ?? "";
}
