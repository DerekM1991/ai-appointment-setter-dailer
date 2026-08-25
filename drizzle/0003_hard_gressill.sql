CREATE TABLE `prospect_outreach_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`campaign_id` text,
	`call_id` text,
	`channel` text DEFAULT 'phone' NOT NULL,
	`status` text DEFAULT 'attempted' NOT NULL,
	`outcome` text,
	`provider_reference` text,
	`notes` text,
	`actor` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outreach_org_lead_idx` ON `prospect_outreach_events` (`organization_id`,`lead_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `outreach_call_idx` ON `prospect_outreach_events` (`call_id`);--> statement-breakpoint
INSERT INTO `prospect_outreach_events` (`id`,`organization_id`,`lead_id`,`campaign_id`,`call_id`,`channel`,`status`,`outcome`,`provider_reference`,`notes`,`actor`,`occurred_at`,`created_at`,`updated_at`)
SELECT 'backfill-' || `id`, `organization_id`, `lead_id`, `campaign_id`, `id`, 'phone', `status`, `outcome`, `twilio_call_sid`, `summary`, 'system:migration', COALESCE(`started_at`,`created_at`), `created_at`, `updated_at` FROM `calls`;--> statement-breakpoint
ALTER TABLE `organizations` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `platform_role` text DEFAULT 'user' NOT NULL;
