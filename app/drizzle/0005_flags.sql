CREATE TABLE `feature_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`definition` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flags_project_key_idx` ON `feature_flags` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `flag_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`flag_id` text NOT NULL,
	`version` integer NOT NULL,
	`description` text NOT NULL,
	`active` integer NOT NULL,
	`definition` text NOT NULL,
	`changed_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`flag_id`) REFERENCES `feature_flags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flag_versions_flag_version_idx` ON `flag_versions` (`flag_id`,`version`);--> statement-breakpoint
ALTER TABLE `projects` ADD `secret_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_secret_key_unique` ON `projects` (`secret_key`);--> statement-breakpoint
-- Existing projects get a secret key; new ones are created with one.
UPDATE `projects` SET `secret_key` = 'fp_sec_' || lower(hex(randomblob(16))) WHERE `secret_key` IS NULL;