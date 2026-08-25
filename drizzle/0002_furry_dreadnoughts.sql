CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text,
	`provider` text NOT NULL,
	`category` text NOT NULL,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`account_identifier` text,
	`encrypted_config` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`last_verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `integrations_org_category_idx` ON `integration_connections` (`organization_id`,`category`,`status`);--> statement-breakpoint
CREATE INDEX `integrations_owner_idx` ON `integration_connections` (`owner_user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`plan_key` text DEFAULT 'trial' NOT NULL,
	`subscription_status` text DEFAULT 'trialing' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`current_period_end` integer,
	`trial_ends_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_stripe_customer_unique` ON `organizations` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_stripe_subscription_unique` ON `organizations` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`organization_id` text NOT NULL,
	`period_key` text NOT NULL,
	`contacts_imported` integer DEFAULT 0 NOT NULL,
	`calls_started` integer DEFAULT 0 NOT NULL,
	`call_minutes` integer DEFAULT 0 NOT NULL,
	`ai_turns` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `period_key`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
DROP INDEX `appointments_start_idx`;--> statement-breakpoint
ALTER TABLE `appointments` ADD `organization_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `appointments_org_start_idx` ON `appointments` (`organization_id`,`start_at`);--> statement-breakpoint
DROP INDEX `campaigns_status_idx`;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `organization_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `created_by_user_id` text;--> statement-breakpoint
CREATE INDEX `campaigns_org_status_idx` ON `campaigns` (`organization_id`,`status`);--> statement-breakpoint
DROP INDEX `leads_phone_unique`;--> statement-breakpoint
DROP INDEX `leads_status_idx`;--> statement-breakpoint
ALTER TABLE `leads` ADD `organization_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `created_by_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `leads_org_phone_unique` ON `leads` (`organization_id`,`phone_e164`);--> statement-breakpoint
CREATE INDEX `leads_org_status_idx` ON `leads` (`organization_id`,`status`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `organization_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `calls` ADD `organization_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `calls_org_status_idx` ON `calls` (`organization_id`,`status`);