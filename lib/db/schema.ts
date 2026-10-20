import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * PRIVACY MODEL
 * - Anything that describes a user's work (sheet source, uploaded file, profile, chat text,
 *   generated exports) is stored ENCRYPTED with that user's own data key (see lib/crypto.ts).
 * - Plain columns on `users` are the only things the admin panel is allowed to read.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"), // null for users who registered through Telegram only
    passwordHash: text("password_hash"),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    timezone: text("timezone").notNull().default("UTC"), // IANA, e.g. Asia/Kolkata
    wrappedDek: text("wrapped_dek").notNull(), // per-user data key, wrapped by QORLOG_MASTER_KEY
    reminderEnabled: boolean("reminder_enabled").notNull().default(true),
    reminderMinutes: integer("reminder_minutes").notNull().default(18 * 60), // local minutes after midnight
    remindWeekends: boolean("remind_weekends").notNull().default(false),
    lastReminderDate: text("last_reminder_date"), // local yyyy-mm-dd of the last reminder sent
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

/** Connects a user to an external messenger identity (Telegram chat id now, WhatsApp number later). */
export const channelLinks = pgTable(
  "channel_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["telegram", "whatsapp"] }).notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_links_external_unique").on(t.channel, t.externalId),
    uniqueIndex("channel_links_user_channel_unique").on(t.userId, t.channel),
  ],
);

/** Conversational state machine for messenger onboarding (registration, adding a timesheet...). */
export const channelState = pgTable(
  "channel_state",
  {
    channel: text("channel").notNull(),
    externalId: text("external_id").notNull(),
    state: text("state").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.externalId] })],
);

/** Single-use codes: web->telegram linking and telegram->web magic login. Only hashes are stored. */
export const linkCodes = pgTable(
  "link_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["telegram_link", "web_login"] }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
);

export const timesheets = pgTable(
  "timesheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["xlsx", "gsheet"] }).notNull(),
    sourceEnc: text("source_enc"), // gsheet: encrypted {spreadsheetId,url}
    fileEnc: text("file_enc"), // xlsx: encrypted workbook bytes (base64 of ciphertext)
    profileEnc: text("profile_enc"), // encrypted TimesheetProfile JSON
    profileStatus: text("profile_status", { enum: ["pending", "ready", "failed"] }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("timesheets_user_name_unique").on(t.userId, sql`lower(${t.name})`)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    contentEnc: text("content_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_user_created_idx").on(t.userId, t.createdAt)],
);

/** Generated Excel/PDF files, encrypted, short-lived. */
export const exportsTable = pgTable("exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  dataEnc: text("data_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Admin-managed catalog of AI models. Agents pick their model from here. */
export const aiModels = pgTable(
  "ai_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("groq"),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    purposes: text("purposes").array().notNull().default(sql`'{chat}'::text[]`), // chat | analysis | utility
    defaultFor: text("default_for").array().notNull().default(sql`'{}'::text[]`),
    contextWindow: integer("context_window"),
    notes: text("notes"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_models_provider_model_unique").on(t.provider, t.modelId)],
);

/** Token usage per model. Contains no content, only counts. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    modelId: text("model_id").notNull(),
    purpose: text("purpose").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_created_idx").on(t.createdAt)],
);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetUserId: uuid("target_user_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Telegram update de-duplication (Telegram retries webhooks that respond slowly). */
export const telegramUpdates = pgTable("telegram_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Timesheet = typeof timesheets.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
