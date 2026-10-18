ALTER TABLE `projects` ADD `internal_users` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `filter_internal` integer DEFAULT false NOT NULL;