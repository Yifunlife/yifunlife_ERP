
CREATE TABLE `quotation_crm_links` (
	`quotation_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`contract_no` text NOT NULL,
	`sales_id` text NOT NULL,
	`sales_name` text NOT NULL,
	`sales_email` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotation_history`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint

CREATE TABLE `quotation_crm_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`quotation_id` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`body_json` text NOT NULL,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotation_history`(`id`) ON UPDATE no action ON DELETE no action
);
