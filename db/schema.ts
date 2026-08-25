import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    company: text("company"),
    title: text("title"),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    timezone: text("timezone"),
    stateRegion: text("state_region"),
    countryCode: text("country_code").notNull().default("US"),
    lineType: text("line_type"),
    consentStatus: text("consent_status", {
      enum: ["express_written", "revoked", "unknown"],
    })
      .notNull()
      .default("unknown"),
    consentCapturedAt: integer("consent_captured_at"),
    consentSource: text("consent_source"),
    consentEvidence: text("consent_evidence"),
    dncCheckedAt: integer("dnc_checked_at"),
    internalDnc: integer("internal_dnc", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", {
      enum: ["blocked", "eligible", "queued", "calling", "completed"],
    })
      .notNull()
      .default("blocked"),
    blockReasonsJson: text("block_reasons_json").notNull().default("[]"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("leads_phone_unique").on(table.phoneE164),
    index("leads_status_idx").on(table.status),
  ],
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sellerName: text("seller_name").notNull().default("Your company"),
    productName: text("product_name").notNull().default("your product or service"),
    agentName: text("agent_name").notNull().default("Alex"),
    productSummary: text("product_summary").notNull(),
    objective: text("objective").notNull().default("Book a discovery call"),
    status: text("status", {
      enum: ["draft", "running", "paused", "completed"],
    })
      .notNull()
      .default("draft"),
    maxConcurrent: integer("max_concurrent").notNull().default(20),
    callsPerSecond: integer("calls_per_second").notNull().default(1),
    meetingDurationMinutes: integer("meeting_duration_minutes")
      .notNull()
      .default(30),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("campaigns_status_idx").on(table.status)],
);

export const campaignLeads = sqliteTable(
  "campaign_leads",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "calling", "completed", "blocked"],
    })
      .notNull()
      .default("queued"),
    priority: integer("priority").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.leadId] }),
    index("campaign_leads_queue_idx").on(
      table.campaignId,
      table.status,
      table.priority,
    ),
  ],
);

export const calls = sqliteTable(
  "calls",
  {
    id: text("id").primaryKey(),
    twilioCallSid: text("twilio_call_sid"),
    campaignId: text("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    outcome: text("outcome"),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    durationSeconds: integer("duration_seconds"),
    transcriptJson: text("transcript_json").notNull().default("[]"),
    summary: text("summary"),
    aiDisclosureAt: integer("ai_disclosure_at"),
    optOutDetectedAt: integer("opt_out_detected_at"),
    appointmentId: text("appointment_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("calls_twilio_sid_unique").on(table.twilioCallSid),
    index("calls_campaign_status_idx").on(table.campaignId, table.status),
    index("calls_lead_idx").on(table.leadId),
  ],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    callId: text("call_id").references(() => calls.id, {
      onDelete: "set null",
    }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    graphEventId: text("graph_event_id"),
    subject: text("subject").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    timezone: text("timezone").notNull(),
    attendeeEmail: text("attendee_email").notNull(),
    joinUrl: text("join_url"),
    status: text("status", {
      enum: ["pending", "confirmed", "cancelled", "failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("appointments_graph_event_unique").on(table.graphEventId),
    index("appointments_start_idx").on(table.startAt),
  ],
);

export const oauthConnections = sqliteTable("oauth_connections", {
  provider: text("provider").primaryKey(),
  accountEmail: text("account_email"),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  scopes: text("scopes").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("audit_events_type_idx").on(table.eventType),
    index("audit_events_created_idx").on(table.createdAt),
  ],
);
