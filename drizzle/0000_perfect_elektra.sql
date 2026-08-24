CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`call_id` text,
	`lead_id` text NOT NULL,
	`graph_event_id` text,
	`subject` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`timezone` text NOT NULL,
	`attendee_email` text NOT NULL,
	`join_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_graph_event_unique` ON `appointments` (`graph_event_id`);--> statement-breakpoint
CREATE INDEX `appointments_start_idx` ON `appointments` (`start_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_type_idx` ON `audit_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`twilio_call_sid` text,
	`campaign_id` text,
	`lead_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`outcome` text,
	`started_at` integer,
	`ended_at` integer,
	`duration_seconds` integer,
	`transcript_json` text DEFAULT '[]' NOT NULL,
	`summary` text,
	`ai_disclosure_at` integer,
	`opt_out_detected_at` integer,
	`appointment_id` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calls_twilio_sid_unique` ON `calls` (`twilio_call_sid`);--> statement-breakpoint
CREATE INDEX `calls_campaign_status_idx` ON `calls` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `calls_lead_idx` ON `calls` (`lead_id`);--> statement-breakpoint
CREATE TABLE `campaign_leads` (
	`campaign_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `lead_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_leads_queue_idx` ON `campaign_leads` (`campaign_id`,`status`,`priority`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`product_summary` text NOT NULL,
	`objective` text DEFAULT 'Book a discovery call' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`max_concurrent` integer DEFAULT 20 NOT NULL,
	`calls_per_second` integer DEFAULT 1 NOT NULL,
	`meeting_duration_minutes` integer DEFAULT 30 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `campaigns_status_idx` ON `campaigns` (`status`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`company` text,
	`title` text,
	`phone_e164` text NOT NULL,
	`email` text,
	`timezone` text,
	`state_region` text,
	`country_code` text DEFAULT 'US' NOT NULL,
	`line_type` text,
	`consent_status` text DEFAULT 'unknown' NOT NULL,
	`consent_captured_at` integer,
	`consent_source` text,
	`consent_evidence` text,
	`dnc_checked_at` integer,
	`internal_dnc` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'blocked' NOT NULL,
	`block_reasons_json` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_phone_unique` ON `leads` (`phone_e164`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE TABLE `oauth_connections` (
	`provider` text PRIMARY KEY NOT NULL,
	`account_email` text,
	`encrypted_access_token` text NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
