CREATE TABLE `hitl_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`app_id` integer NOT NULL,
	`phase` text NOT NULL,
	`chat_id` integer,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`target_role_id` text NOT NULL,
	`visibility` text DEFAULT 'role' NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`bead_id` text,
	`answered_by_user_id` text,
	`answered_by_name` text,
	`answered_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hitl_questions_idempotency_unique` ON `hitl_questions` (`org_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `hitl_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `hitl_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hitl_answers_question_unique` ON `hitl_answers` (`question_id`);
