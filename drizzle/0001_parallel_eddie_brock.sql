CREATE TABLE `analysis_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileName` varchar(255),
	`sgfStorageKey` varchar(512),
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`mistakeCount` int DEFAULT 0,
	`language` varchar(5) DEFAULT 'ko',
	`resultJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `analysis_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `subscriptionTier` enum('free','basic','premium') DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `remainingAnalysisCount` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `maxAnalysisCount` int DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `subscriptionStartDate` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `preferredLanguage` varchar(5) DEFAULT 'ko';