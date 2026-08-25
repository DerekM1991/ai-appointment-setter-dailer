ALTER TABLE `calls` ADD `telephony_provider` text DEFAULT 'twilio' NOT NULL;--> statement-breakpoint
ALTER TABLE `calls` ADD `ai_provider` text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE `calls` ADD `provider_call_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `calls_provider_id_unique` ON `calls` (`telephony_provider`,`provider_call_id`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `telephony_provider` text DEFAULT 'twilio' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `ai_provider` text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_call_unique` ON `appointments` (`call_id`);