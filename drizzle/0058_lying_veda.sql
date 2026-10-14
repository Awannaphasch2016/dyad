CREATE TABLE `factory_phase_machines` (
	`app_id` integer NOT NULL,
	`phase` text NOT NULL,
	`status` text NOT NULL,
	`iteration` integer DEFAULT 1 NOT NULL,
	`open_question_id` text,
	`hook_attempt` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`feedback` text,
	`failure_reason` text,
	`finish_text` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`app_id`, `phase`),
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
