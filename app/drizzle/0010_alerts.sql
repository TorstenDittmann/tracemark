CREATE TABLE `alert_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`destination_id` text,
	`destination_name` text NOT NULL,
	`rule_id` text,
	`title` text NOT NULL,
	`ok` integer NOT NULL,
	`status_code` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `alert_destinations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `alert_deliveries_project_created_idx` ON `alert_deliveries` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `alert_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`format` text DEFAULT 'json' NOT NULL,
	`secret` text,
	`last_status` text,
	`last_error` text,
	`last_delivered_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_destinations_project_id_idx` ON `alert_destinations` (`project_id`);--> statement-breakpoint
CREATE TABLE `alert_rule_destinations` (
	`rule_id` text NOT NULL,
	`destination_id` text NOT NULL,
	PRIMARY KEY(`rule_id`, `destination_id`),
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `alert_destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_rule_destinations_destination_id_idx` ON `alert_rule_destinations` (`destination_id`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`notify_resolved` integer DEFAULT false NOT NULL,
	`cooldown_minutes` integer DEFAULT 60 NOT NULL,
	`state` text DEFAULT 'ok' NOT NULL,
	`state_notified` integer DEFAULT false NOT NULL,
	`last_value` real,
	`checked_until` integer,
	`last_checked_at` integer,
	`last_fired_at` integer,
	`last_error` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `alert_rules_project_id_idx` ON `alert_rules` (`project_id`);--> statement-breakpoint
CREATE TABLE `job_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`expires_at` integer NOT NULL
);
