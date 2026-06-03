CREATE TABLE `auto_emailing` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_post_url` text NOT NULL,
	`targeted_lead_magnet_id` text,
	`follow_up_one_lead_magnet_id` text,
	`follow_up_two_lead_magnet_id` text,
	`scraped` integer DEFAULT false NOT NULL,
	`post_content` text,
	`poster_name` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auto_emailing_original_post_url_unique` ON `auto_emailing` (`original_post_url`);