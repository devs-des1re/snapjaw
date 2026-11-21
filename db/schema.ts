import { createSqliteSchema } from "@krate/auth/drizzle/sqlite";
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const { users, accounts, sessions, verificationTokens, authenticators, twoFactors } = createSqliteSchema();

const now = () => new Date();
const createdAt = () => integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(now);

export const adminProfiles = sqliteTable("adminProfile", {
  userId: text("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("passwordHash"),
  disabledAt: integer("disabledAt", { mode: "timestamp_ms" }),
  invitedBy: text("invitedBy"),
  lastLoginAt: integer("lastLoginAt", { mode: "timestamp_ms" }),
  lastLoginIp: text("lastLoginIp"),
  createdAt: createdAt(),
});

export const sessionMeta = sqliteTable("sessionMeta", {
  sessionToken: text("sessionToken").primaryKey().references(() => sessions.sessionToken, { onDelete: "cascade" }),
  userId: text("userId").notNull(),
  publicId: text("publicId").notNull().unique(),
  userAgent: text("userAgent"),
  ip: text("ip"),
  createdAt: createdAt(),
});

export const invites = sqliteTable("invite", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "admin", "viewer"] }).notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  createdBy: text("createdBy").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  acceptedAt: integer("acceptedAt", { mode: "timestamp_ms" }),
  revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const auditLog = sqliteTable(
  "auditLog",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: text("actorId"),
    actorEmail: text("actorEmail"),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("userAgent"),
    createdAt: createdAt(),
  },
  (t) => [index("auditLog_createdAt").on(t.createdAt)],
);

export const settings = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  encrypted: integer("encrypted", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const domains = sqliteTable("domain", {
  id: text("id").primaryKey(),
  resendId: text("resendId").unique(),
  name: text("name").notNull().unique(),
  status: text("status").notNull().default("not_started"),
  region: text("region"),
  sending: integer("sending", { mode: "boolean" }).notNull().default(true),
  receiving: integer("receiving", { mode: "boolean" }).notNull().default(false),
  records: text("records", { mode: "json" }).$type<DnsRecord[]>().notNull().default(sql`'[]'`),
  checkedAt: integer("checkedAt", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export type DnsRecord = {
  record: string;
  name: string;
  type: string;
  ttl?: string;
  status?: string;
  value: string;
  priority?: number;
};

export const smtpCredentials = sqliteTable("smtpCredential", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  allowedSenders: text("allowedSenders", { mode: "json" }).$type<string[]>().notNull(),
  ratePerHour: integer("ratePerHour").notNull().default(100),
  lastUsedAt: integer("lastUsedAt", { mode: "timestamp_ms" }),
  revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const apiKeys = sqliteTable("apiKey", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
  secretHash: text("secretHash").notNull(),
  allowedSenders: text("allowedSenders", { mode: "json" }).$type<string[]>().notNull(),
  ratePerHour: integer("ratePerHour").notNull().default(100),
  lastUsedAt: integer("lastUsedAt", { mode: "timestamp_ms" }),
  revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const destinations = sqliteTable("destination", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["gmail", "imap", "forward"] }).notNull(),
  config: text("config").notNull(),
  health: text("health", { enum: ["unknown", "ok", "failing"] }).notNull().default("unknown"),
  lastError: text("lastError"),
  lastCheckedAt: integer("lastCheckedAt", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const routes = sqliteTable(
  "route",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["address", "wildcard", "catchall"] }).notNull(),
    pattern: text("pattern").notNull(),
    domain: text("domain").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("route_pattern").on(t.pattern)],
);

export const routeDestinations = sqliteTable(
  "routeDestination",
  {
    routeId: text("routeId").notNull().references(() => routes.id, { onDelete: "cascade" }),
    destinationId: text("destinationId").notNull().references(() => destinations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.routeId, t.destinationId] })],
);

export const messages = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
    resendId: text("resendId").unique(),
    messageId: text("messageId"),
    fromAddress: text("fromAddress").notNull(),
    toAddresses: text("toAddresses", { mode: "json" }).$type<string[]>().notNull(),
    subject: text("subject"),
    size: integer("size").notNull().default(0),
    recipients: integer("recipients").notNull().default(1),
    status: text("status").notNull(),
    error: text("error"),
    source: text("source"),
    credentialId: text("credentialId"),
    createdAt: createdAt(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("message_createdAt").on(t.createdAt),
    index("message_status").on(t.status),
    index("message_direction").on(t.direction),
  ],
);

export const messageEvents = sqliteTable(
  "messageEvent",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: text("messageId").notNull().references(() => messages.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("messageEvent_messageId").on(t.messageId)],
);

export const blobs = sqliteTable("blob", {
  messageId: text("messageId").primaryKey().references(() => messages.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const deliveries = sqliteTable(
  "delivery",
  {
    id: text("id").primaryKey(),
    messageId: text("messageId").notNull().references(() => messages.id, { onDelete: "cascade" }),
    destinationId: text("destinationId").notNull(),
    recipient: text("recipient").notNull(),
    state: text("state", { enum: ["pending", "in_flight", "done", "failed", "skipped"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("delivery_message_destination").on(t.messageId, t.destinationId)],
);

export const jobs = sqliteTable(
  "job",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    ref: text("ref").notNull(),
    state: text("state", { enum: ["queued", "running", "done", "dead"] }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(10),
    runAt: integer("runAt", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
    leaseUntil: integer("leaseUntil", { mode: "timestamp_ms" }),
    lastError: text("lastError"),
    createdAt: createdAt(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (t) => [index("job_ready").on(t.state, t.runAt), uniqueIndex("job_kind_ref").on(t.kind, t.ref)],
);

export const suppressions = sqliteTable("suppression", {
  email: text("email").primaryKey(),
  reason: text("reason", { enum: ["bounce", "complaint", "manual"] }).notNull(),
  detail: text("detail"),
  source: text("source"),
  createdAt: createdAt(),
});

export const webhookEvents = sqliteTable("webhookEvent", {
  svixId: text("svixId").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("receivedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const usage = sqliteTable("usage", {
  day: text("day").primaryKey(),
  sent: integer("sent").notNull().default(0),
  received: integer("received").notNull().default(0),
  resendDaily: integer("resendDaily"),
  resendMonthly: integer("resendMonthly"),
  alertedAt: integer("alertedAt", { mode: "timestamp_ms" }),
});

export const idempotencyKeys = sqliteTable("idempotencyKey", {
  key: text("key").primaryKey(),
  messageId: text("messageId").notNull(),
  bodyHash: text("bodyHash").notNull(),
  createdAt: createdAt(),
});

export const oauthStates = sqliteTable("oauthState", {
  state: text("state").primaryKey(),
  destinationId: text("destinationId").notNull(),
  verifier: text("verifier").notNull(),
  createdBy: text("createdBy").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
});
