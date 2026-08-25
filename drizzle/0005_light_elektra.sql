CREATE TABLE `crm_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`assigned_to_user_id` text,
	`created_by_user_id` text NOT NULL,
	`title` text NOT NULL,
	`due_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `crm_tasks_org_status_due_idx` ON `crm_tasks` (`organization_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `crm_tasks_lead_idx` ON `crm_tasks` (`lead_id`);--> statement-breakpoint
ALTER TABLE `leads` ADD `crm_stage` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `assigned_to_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `leads` ADD `next_follow_up_at` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `deal_value_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `leads_org_crm_stage_idx` ON `leads` (`organization_id`,`crm_stage`);