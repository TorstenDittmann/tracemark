CREATE TABLE `ai_model_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`model` text NOT NULL,
	`input` real NOT NULL,
	`output` real NOT NULL,
	`cache_read` real,
	`cache_write` real,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_model_prices_project_model_idx` ON `ai_model_prices` (`project_id`,`model`);