ALTER TABLE `organizations` ADD `billing_override_type` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_discount_percent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_override_starts_at` integer;--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_override_ends_at` integer;--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_override_note` text;