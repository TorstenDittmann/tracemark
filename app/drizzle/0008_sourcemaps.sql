CREATE TABLE `sourcemaps` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`release` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sourcemaps_project_release_name_idx` ON `sourcemaps` (`project_id`,`release`,`name`);