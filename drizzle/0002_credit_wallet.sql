CREATE TABLE `user_wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clerkUserId` varchar(128) NOT NULL,
	`userId` int,
	`balance` int NOT NULL DEFAULT 0,
	`signupBonusGranted` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_wallets_clerkUserId_unique` UNIQUE(`clerkUserId`)
);
--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`walletId` int NOT NULL,
	`type` enum('signup_bonus','purchase','spend','refund','admin_adjustment') NOT NULL,
	`amount` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`analysisJobId` varchar(64),
	`idempotencyKey` varchar(191) NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_ledger_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
