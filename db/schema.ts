import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    platformRole: text("platform_role", { enum: ["user", "super_admin"] }).notNull().default("user"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    lastSeenAt: integer("last_seen_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    planKey: text("plan_key", { enum: ["trial", "starter", "growth", "pro"] })
      .notNull()
      .default("trial"),
    subscriptionStatus: text("subscription_status", {
      enum: ["trialing", "active", "past_due", "canceled", "incomplete"],
    })
      .notNull()
      .default("trialing"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodEnd: integer("current_period_end"),
    trialEndsAt: integer("trial_ends_at"),
    billingOverrideType: text("billing_override_type", { enum: ["none", "complimentary", "discount"] }).notNull().default("none"),
    billingDiscountPercent: integer("billing_discount_percent").notNull().default(0),
    billingOverrideStartsAt: integer("billing_override_starts_at"),
    billingOverrideEndsAt: integer("billing_override_ends_at"),
    billingOverrideNote: text("billing_override_note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("organizations_slug_unique").on(table.slug),
    uniqueIndex("organizations_stripe_customer_unique").on(table.stripeCustomerId),
    uniqueIndex("organizations_stripe_subscription_unique").on(table.stripeSubscriptionId),
  ],
);

export const memberships = sqliteTable(
  "memberships",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "manager", "member", "viewer"] })
      .notNull()
      .default("member"),
    status: text("status", { enum: ["active", "invited", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("memberships_user_idx").on(table.userId, table.status),
  ],
);

export const integrationConnections = sqliteTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["twilio", "openai", "microsoft", "google", "calcom"],
    }).notNull(),
    category: text("category", { enum: ["telephony", "ai", "calendar"] }).notNull(),
    scope: text("scope", { enum: ["workspace", "personal"] }).notNull(),
    label: text("label").notNull(),
    accountIdentifier: text("account_identifier"),
    encryptedConfig: text("encrypted_config").notNull(),
    status: text("status", { enum: ["connected", "error", "disabled"] })
      .notNull()
      .default("connected"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    lastVerifiedAt: integer("last_verified_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("integrations_org_category_idx").on(table.organizationId, table.category, table.status),
    index("integrations_owner_idx").on(table.ownerUserId, table.provider),
  ],
);

export const usageCounters = sqliteTable(
  "usage_counters",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    contactsImported: integer("contacts_imported").notNull().default(0),
    callsStarted: integer("calls_started").notNull().default(0),
    callMinutes: integer("call_minutes").notNull().default(0),
    aiTurns: integer("ai_turns").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.periodKey] })],
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().default("legacy"),
    createdByUserId: text("created_by_user_id"),
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
    uniqueIndex("leads_org_phone_unique").on(table.organizationId, table.phoneE164),
    index("leads_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().default("legacy"),
    createdByUserId: text("created_by_user_id"),
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
  (table) => [index("campaigns_org_status_idx").on(table.organizationId, table.status)],
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
    organizationId: text("organization_id").notNull().default("legacy"),
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
    index("calls_org_status_idx").on(table.organizationId, table.status),
    index("calls_campaign_status_idx").on(table.campaignId, table.status),
    index("calls_lead_idx").on(table.leadId),
  ],
);

export const prospectOutreachEvents = sqliteTable(
  "prospect_outreach_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    callId: text("call_id").references(() => calls.id, { onDelete: "set null" }),
    channel: text("channel", { enum: ["phone", "email", "sms", "manual"] }).notNull().default("phone"),
    status: text("status").notNull().default("attempted"),
    outcome: text("outcome"),
    providerReference: text("provider_reference"),
    notes: text("notes"),
    actor: text("actor").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("outreach_org_lead_idx").on(table.organizationId, table.leadId, table.occurredAt),
    index("outreach_call_idx").on(table.callId),
  ],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().default("legacy"),
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
    index("appointments_org_start_idx").on(table.organizationId, table.startAt),
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
    organizationId: text("organization_id").notNull().default("legacy"),
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
