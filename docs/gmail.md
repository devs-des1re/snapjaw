# Gmail setup guide

This guide connects one Gmail account to Snapjaw in both directions:

- **Sending.** Gmail's "Send mail as" sends `hello@example.com` through Snapjaw's SMTP server, and Snapjaw sends it through Resend, so it is signed with your domain's DKIM.
- **Receiving.** Mail to `hello@example.com` arrives at Resend, and Snapjaw puts it in your Gmail inbox with the original sender intact.

Before you start, finish the [self-hosting guide](self-hosting.md): the domain must be verified, the webhook connected, and SMTP must have a trusted certificate for `SNAPJAW_SMTP_HOSTNAME`.

## Sending: Send mail as

### 1. Create an SMTP login in Snapjaw

1. Open **Credentials** and stay on **SMTP logins**.
2. Name it, for example `Gmail send-as`.
3. Under **Allowed senders** enter `hello@example.com`, or `@example.com` to allow every address on the domain.
4. Press **Create login** and copy the server, username and password. The password is shown once.

### 2. Add the address in Gmail

1. In Gmail open **Settings**, **See all settings**, **Accounts and Import**.
2. Under **Send mail as** press **Add another email address**.
3. Enter the name to show and `hello@example.com`. Leave **Treat as an alias** on unless you want replies kept apart. Press **Next Step**.
4. Fill in:
   - **SMTP Server:** your `SNAPJAW_SMTP_HOSTNAME`, such as `relay.example.com`
   - **Port:** `587`
   - **Username** and **Password:** from step 1
   - **Secured connection using TLS** selected. Port 465 with SSL also works.
5. Press **Add Account**. Gmail sends a verification email to `hello@example.com`. Once receiving works (below), it arrives in the same inbox. Click the link or enter the code.

If Gmail says it cannot reach the server, run `snapjaw doctor`. The usual causes are a self-signed certificate, a certificate for another host name, or port 587 not open in the firewall.

Google has said that from January 2027 Gmail stops offering Send mail as for some third-party addresses. Its notice does not say whether a domain you own, sent through your own SMTP server, is affected. Snapjaw's SMTP server works with any mail client, so you can switch clients if Gmail changes.

### 3. Send a test

Compose a message in Gmail, pick `hello@example.com` in the From field and send it to an outside address. In Snapjaw, **Messages** shows it go from queued to sent to delivered. In the received message, the headers show `dkim=pass` for `example.com`.

## Receiving into Gmail

There are three destination types. Use the first one you can.

### Option A: Gmail API import (recommended)

Gmail import adds the message exactly as it was received. The original sender, headers and attachments stay intact, and Gmail does not run its own spam check on it a second time. You need your own Google OAuth client.

#### Create the Google OAuth client

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project, and open **APIs and Services**.
2. Under **Library**, enable the **Gmail API**.
3. Under **OAuth consent screen**, pick **External** (or **Internal** on Google Workspace). Fill in the app name and your email. Under **Scopes** add `https://www.googleapis.com/auth/gmail.insert` and `https://www.googleapis.com/auth/gmail.readonly`. Under **Test users** add your Gmail address.
4. Under **Credentials** press **Create credentials**, **OAuth client ID**, type **Web application**.
5. Under **Authorized redirect URIs** add the URI that Snapjaw shows under **Settings, Gmail API**. It looks like `https://relay.example.com/api/destinations/gmail/callback`.
6. Copy the client ID and secret into **Settings, Gmail API** and save.

`gmail.insert` and `gmail.readonly` are restricted scopes. While the app is in **Testing** status, Google expires refresh tokens after 7 days, and the destination stops working until you reconnect it. For a personal setup, publish the app (**OAuth consent screen, Publish app**). Google shows an "unverified app" warning on sign-in, which you can accept for your own account. Verification is only needed if other people will use your client.

Snapjaw uses `gmail.readonly` for one thing: after a crash in the middle of an import, it checks whether the message is already in Gmail before importing it again, so nothing arrives twice.

#### Connect it

1. Open **Destinations**, pick **Gmail API**, name it and enter your Gmail address.
2. Press **Create and connect Gmail**, sign in with Google and allow access.
3. Back in Snapjaw, press **Test** on the destination.

### Option B: IMAP with an app password

Works with Gmail and any other IMAP mailbox. Simpler to set up, but Gmail may treat the message like any appended message.

1. Turn on 2-Step Verification for the Google account.
2. Create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. In Snapjaw open **Destinations**, pick **IMAP** and enter:
   - **IMAP server:** `imap.gmail.com`, **Port:** `993`, TLS on
   - **Username:** your Gmail address
   - **Password:** the 16-character app password
   - **Mailbox:** `INBOX`
4. Press **Create destination**, then **Test**.

App passwords are not available for accounts that use only security keys, for Advanced Protection, or when a Workspace admin turned them off.

### Option C: forward via Resend

Last resort. Snapjaw sends a new message from an address on your domain to your Gmail address, with the original sender in Reply-To. The sender shown in Gmail changes, and every forward costs one more email against the Resend quota.

## Route the address

1. Open **Routes**.
2. Kind **Exact address**, address `hello@example.com`, tick the destination.
3. Press **Create route**, then **Send test** on the route. The test comes from an address on your domain and should land in Gmail within a minute.

Use **Catch-all for a domain** to deliver every address on the domain, and **Wildcard** for patterns such as `support-*@example.com`. A route can deliver to several destinations, and one failing destination does not hold up the others.

## Troubleshooting

- **The message shows "rejected: No route".** Add a route for the address or a catch-all.
- **Gmail destination says invalid_grant.** The refresh token expired or was revoked. Publish the OAuth app and press **Reconnect**.
- **IMAP says AUTHENTICATIONFAILED.** Use an app password, not the account password.
- **Nothing arrives at all.** Check **Domains**: the MX record must be verified. Then check **Settings, Webhook**. If the webhook was down, the reconciler picks up missed mail every few minutes.
