export type Help = { summary: string; fix: string | null };

const patterns: { test: RegExp; fix: string }[] = [
  { test: /not verified/i, fix: "Open Domains, add the DNS records shown there at your DNS provider, then press Re-check." },
  { test: /allowed senders|may not send as/i, fix: "Open Credentials and add the address or its @domain to the credential's allowed senders." },
  { test: /quota/i, fix: "Wait for the quota to reset, raise the limits under Settings if your Resend plan allows more, or upgrade the Resend plan." },
  { test: /suppress/i, fix: "Remove the address from Suppressions only if you are sure it can receive mail again." },
  { test: /api key/i, fix: "Save a valid full access Resend API key under Settings." },
  { test: /invalid_grant|token has been expired or revoked|refresh token/i, fix: "Open Destinations and reconnect the Gmail account. Refresh tokens from an OAuth app in Testing status expire after 7 days." },
  { test: /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i, fix: "Check the IMAP username and password. Gmail needs an app password, not the account password." },
  { test: /ENOTFOUND|EAI_AGAIN|getaddrinfo/i, fix: "Snapjaw could not resolve the host name. Check the server address and DNS." },
  { test: /ECONNREFUSED|ETIMEDOUT|timed out/i, fix: "The server did not answer. Check the host, port and firewall." },
  { test: /certificate|self[- ]signed|CERT_/i, fix: "The server's TLS certificate is not trusted. Use the host name the certificate was issued for." },
  { test: /loop/i, fix: "A route sends mail back to an address that Snapjaw relays. Point the route at a mailbox outside your Snapjaw domains." },
  { test: /no route/i, fix: "Add a route for this address, or a catch-all for the domain, under Routes." },
  { test: /too large|byte limit/i, fix: "Raise the message size limit under Settings, or ask the sender for a smaller message." },
  { test: /bounce/i, fix: "The recipient's server refused the message. Check the address for typos. A permanent bounce adds it to Suppressions." },
  { test: /spam|complain/i, fix: "The recipient marked the message as spam. They were added to Suppressions so they do not get more mail." },
];

const summaries: Record<string, string> = {
  accepted: "Snapjaw accepted the message.",
  queued: "Waiting in the queue to be sent or delivered.",
  held: "Held because the Resend quota is used up. It is sent automatically when the quota resets.",
  sent: "Resend accepted the message and is delivering it.",
  delivered: "The recipient's server accepted the message.",
  delivery_delayed: "The recipient's server deferred the message. Resend keeps retrying.",
  bounced: "The recipient's server rejected the message.",
  complained: "The recipient marked the message as spam.",
  failed: "Delivery failed and will not be retried automatically.",
  suppressed: "Skipped because the recipient is suppressed.",
  rejected: "Snapjaw refused the message.",
  partial: "Delivered to some destinations. Others failed.",
  received: "Resend received the message. Snapjaw is fetching it.",
};

export function explainStatus(status: string, error: string | null): Help {
  const summary = summaries[status] ?? status.replace(/_/g, " ");
  if (!error) return { summary, fix: null };
  const match = patterns.find((pattern) => pattern.test.test(error));
  return { summary, fix: match?.fix ?? "Check the error above. If it repeats, run snapjaw doctor." };
}
