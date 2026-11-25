import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Auth (Better Auth core + organization plugin)                       */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("member_org_idx").on(t.organizationId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ------------------------------------------------------------------ */
/* CRM core                                                            */
/* ------------------------------------------------------------------ */

export const contactStatus = pgEnum("contact_status", [
  "lead",
  "prospect",
  "customer",
  "churned",
]);

const orgId = () =>
  text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    phone: text("phone"),
    address: text("address"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("companies_org_idx").on(t.orgId, t.name)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    status: contactStatus("status").notNull().default("lead"),
    source: text("source"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("contacts_org_idx").on(t.orgId, t.createdAt),
    index("contacts_company_idx").on(t.companyId),
    index("contacts_email_idx").on(t.orgId, t.email),
    index("contacts_phone_idx").on(t.orgId, t.phone),
  ],
);

/** Timeline entries shown on a contact / company page. */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references((): AnyPgColumn => deals.id, { onDelete: "set null" }),
    type: text("type").notNull(), // note | created | updated | call | email | meeting
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_contact_idx").on(t.contactId, t.createdAt),
    index("activities_company_idx").on(t.companyId, t.createdAt),
    index("activities_deal_idx").on(t.dealId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Service: tickets and appointments                                   */
/* ------------------------------------------------------------------ */

export const ticketStatus = pgEnum("ticket_status", ["open", "pending", "resolved"]);
export const ticketPriority = pgEnum("ticket_priority", ["low", "normal", "high", "urgent"]);
export const messageKind = pgEnum("message_kind", ["inbound", "outbound", "note"]);
export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

/** A customer request handled by the service team. `number` is per organization. */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    number: integer("number").notNull(),
    subject: text("subject").notNull(),
    status: ticketStatus("status").notNull().default("open"),
    priority: ticketPriority("priority").notNull().default("normal"),
    channel: text("channel").notNull().default("manual"), // manual | phone | email | whatsapp | web | ai
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tickets_org_number_idx").on(t.orgId, t.number),
    index("tickets_queue_idx").on(t.orgId, t.status, t.lastMessageAt),
    index("tickets_contact_idx").on(t.contactId),
  ],
);

/** Conversation on a ticket: customer messages, replies and internal notes. */
export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    kind: messageKind("kind").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("scheduled"),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    location: text("location"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("appointments_org_start_idx").on(t.orgId, t.startsAt),
    index("appointments_contact_idx").on(t.contactId, t.startsAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Sales: pipeline stages and deals                                    */
/* ------------------------------------------------------------------ */

export const dealStatus = pgEnum("deal_status", ["open", "won", "lost"]);

/** Open stages of an organization's pipeline. Won and lost are deal outcomes, not stages. */
export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    probability: integer("probability").notNull().default(0), // 0–100, for the weighted forecast
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pipeline_stages_org_idx").on(t.orgId, t.position)],
);

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    title: text("title").notNull(),
    amount: integer("amount").notNull().default(0), // whole currency units
    currency: text("currency").notNull().default("ILS"),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    status: dealStatus("status").notNull().default("open"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    expectedClose: date("expected_close"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("deals_board_idx").on(t.orgId, t.status, t.stageId),
    index("deals_contact_idx").on(t.contactId),
    index("deals_company_idx").on(t.companyId),
  ],
);

/** Append-only security/audit log (who did what). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    target: text("target").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Platform: API keys, webhooks, rate limits                           */
/* ------------------------------------------------------------------ */

/**
 * Organization API key. Only a SHA-256 hash of the secret is stored; the
 * plaintext is shown once on creation. `role` caps what the key may do.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // first characters, for display: crm_live_ab12…
    hash: text("hash").notNull(),
    role: text("role").notNull().default("admin"),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.hash), index("api_keys_org_idx").on(t.orgId)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    url: text("url").notNull(),
    secret: text("secret").notNull(), // HMAC signing secret, shown to the owner
    events: text("events").array().notNull().default(sql`'{}'::text[]`), // empty = all events
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.orgId)],
);

export const deliveryStatus = pgEnum("delivery_status", ["pending", "succeeded", "failed"]);

/** Outbox: one row per (event, endpoint). Retried with exponential backoff. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
  ],
);

/** Fixed-window counters shared by every app instance. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(), // bucket:window
  count: integer("count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const companiesRelations = relations(companies, ({ many, one }) => ({
  contacts: many(contacts),
  owner: one(user, { fields: [companies.ownerId], references: [user.id] }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
  owner: one(user, { fields: [contacts.ownerId], references: [user.id] }),
}));

export type Contact = typeof contacts.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
