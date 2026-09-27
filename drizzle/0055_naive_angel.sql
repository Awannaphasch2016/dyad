CREATE TABLE `answer_locks` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`member_name` text DEFAULT '' NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `factory_phase_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`phase` text NOT NULL,
	`member_id` text DEFAULT '' NOT NULL,
	`member_name` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`remote_id` text,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `app_knowledge_items` ADD `remote_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `remote_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `owner_type` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `owner_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `apps_remote_id_unique` ON `apps` (`remote_id`);--> statement-breakpoint
ALTER TABLE `chats` ADD `remote_id` text;--> statement-breakpoint
ALTER TABLE `factory_phase_approvals` ADD `member_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `factory_phase_approvals` ADD `member_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `factory_phase_approvals` ADD `role_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `factory_phase_approvals` ADD `remote_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `remote_id` text;