CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `adminProfile` (
	`userId` text PRIMARY KEY NOT NULL,
	`passwordHash` text,
	`disabledAt` integer,
	`invitedBy` text,
	`lastLoginAt` integer,
	`lastLoginIp` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `apiKey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`secretHash` text NOT NULL,
	`allowedSenders` text NOT NULL,
	`ratePerHour` integer DEFAULT 100 NOT NULL,
	`lastUsedAt` integer,
	`revokedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apiKey_prefix_unique` ON `apiKey` (`prefix`);--> statement-breakpoint
CREATE TABLE `auditLog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actorId` text,
	`actorEmail` text,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`ip` text,
	`userAgent` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auditLog_createdAt` ON `auditLog` (`createdAt`);--> statement-breakpoint
CREATE TABLE `authenticator` (
	`credentialID` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`credentialPublicKey` text NOT NULL,
	`counter` integer NOT NULL,
	`credentialDeviceType` text NOT NULL,
	`credentialBackedUp` integer NOT NULL,
	`transports` text,
	`name` text,
	`createdAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blob` (
	`messageId` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`meta` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`destinationId` text NOT NULL,
	`recipient` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_message_destination` ON `delivery` (`messageId`,`destinationId`);--> statement-breakpoint
CREATE TABLE `destination` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`health` text DEFAULT 'unknown' NOT NULL,
	`lastError` text,
	`lastCheckedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domain` (
	`id` text PRIMARY KEY NOT NULL,
	`resendId` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`region` text,
	`sending` integer DEFAULT true NOT NULL,
	`receiving` integer DEFAULT false NOT NULL,
	`records` text DEFAULT '[]' NOT NULL,
	`checkedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_resendId_unique` ON `domain` (`resendId`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_name_unique` ON `domain` (`name`);--> statement-breakpoint
CREATE TABLE `idempotencyKey` (
	`key` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`bodyHash` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`tokenHash` text NOT NULL,
	`createdBy` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`acceptedAt` integer,
	`revokedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_tokenHash_unique` ON `invite` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 10 NOT NULL,
	`runAt` integer NOT NULL,
	`leaseUntil` integer,
	`lastError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_ready` ON `job` (`state`,`runAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_kind_ref` ON `job` (`kind`,`ref`);--> statement-breakpoint
CREATE TABLE `messageEvent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`messageId` text NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messageEvent_messageId` ON `messageEvent` (`messageId`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`direction` text NOT NULL,
	`resendId` text,
	`messageId` text,
	`fromAddress` text NOT NULL,
	`toAddresses` text NOT NULL,
	`subject` text,
	`size` integer DEFAULT 0 NOT NULL,
	`recipients` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`source` text,
	`credentialId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_resendId_unique` ON `message` (`resendId`);--> statement-breakpoint
CREATE INDEX `message_createdAt` ON `message` (`createdAt`);--> statement-breakpoint
CREATE INDEX `message_status` ON `message` (`status`);--> statement-breakpoint
CREATE INDEX `message_direction` ON `message` (`direction`);--> statement-breakpoint
CREATE TABLE `oauthState` (
	`state` text PRIMARY KEY NOT NULL,
	`destinationId` text NOT NULL,
	`verifier` text NOT NULL,
	`createdBy` text NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routeDestination` (
	`routeId` text NOT NULL,
	`destinationId` text NOT NULL,
	PRIMARY KEY(`routeId`, `destinationId`),
	FOREIGN KEY (`routeId`) REFERENCES `route`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destinationId`) REFERENCES `destination`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `route` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`pattern` text NOT NULL,
	`domain` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`note` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_pattern` ON `route` (`pattern`);--> statement-breakpoint
CREATE TABLE `sessionMeta` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`publicId` text NOT NULL,
	`userAgent` text,
	`ip` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`sessionToken`) REFERENCES `session`(`sessionToken`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessionMeta_publicId_unique` ON `sessionMeta` (`publicId`);--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`encrypted` integer DEFAULT false NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `smtpCredential` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`passwordHash` text NOT NULL,
	`allowedSenders` text NOT NULL,
	`ratePerHour` integer DEFAULT 100 NOT NULL,
	`lastUsedAt` integer,
	`revokedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `smtpCredential_username_unique` ON `smtpCredential` (`username`);--> statement-breakpoint
CREATE TABLE `suppression` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`source` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `twoFactor` (
	`userId` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backupCodes` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`lastUsedCounter` integer,
	`createdAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`day` text PRIMARY KEY NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`resendDaily` integer,
	`resendMonthly` integer,
	`alertedAt` integer
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text,
	`role` text,
	`twoFactorEnabled` integer DEFAULT false NOT NULL,
	`createdAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `webhookEvent` (
	`svixId` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`receivedAt` integer NOT NULL
);
