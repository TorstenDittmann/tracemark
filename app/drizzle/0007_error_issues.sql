CREATE TABLE `error_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`status_changed_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`status_changed_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_issues_project_fingerprint_idx` ON `error_issues` (`project_id`,`fingerprint`);