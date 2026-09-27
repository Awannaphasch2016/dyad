CREATE TABLE `factory_host_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`requested_role` text NOT NULL,
	`message_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `factory_host_messages_chat_key_unique` ON `factory_host_messages` (`chat_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `factory_host_messages_message_unique` ON `factory_host_messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `factory_host_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`app_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`phase` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`prompt_hash` text NOT NULL,
	`intent_id` text NOT NULL,
	`acceptance` text DEFAULT 'queued' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `factory_host_runs_app_phase_key_unique` ON `factory_host_runs` (`app_id`,`phase`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `factory_host_runs_intent_unique` ON `factory_host_runs` (`intent_id`);--> statement-breakpoint
CREATE TABLE `factory_phase_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`phase` text NOT NULL,
	`approved_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `factory_phase_approvals_app_phase_unique` ON `factory_phase_approvals` (`app_id`,`phase`);--> statement-breakpoint
ALTER TABLE `apps` ADD `factory_host_managed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `gas_city_project_id` text;