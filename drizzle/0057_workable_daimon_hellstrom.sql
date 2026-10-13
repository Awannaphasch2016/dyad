ALTER TABLE `factory_host_runs` ADD `gas_city_task_id` text;--> statement-breakpoint
ALTER TABLE `factory_host_runs` ADD `orchestrator_status` text;--> statement-breakpoint
ALTER TABLE `factory_host_runs` ADD `event_cursor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `factory_host_runs` ADD `assistant_message_id` integer;