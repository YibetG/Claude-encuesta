CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logo_data` blob,
	`logo_mime` text,
	`logo_updated_at` integer,
	`theme_primary` text,
	`theme_accent` text,
	`created_by_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `assessments` ADD `client_id` text REFERENCES clients(id);--> statement-breakpoint
-- Datos: cada assessment con logo o colores propios pasa a tener un cliente con esa marca.
-- Se reutiliza el id del assessment como id del cliente para enlazarlos sin tablas auxiliares.
INSERT INTO `clients` (`id`, `name`, `logo_data`, `logo_mime`, `logo_updated_at`, `theme_primary`, `theme_accent`, `created_by_id`, `created_at`, `updated_at`)
SELECT `id`, substr('Cliente de ' || `title`, 1, 120), `logo_data`, `logo_mime`, `logo_updated_at`, `theme_primary`, `theme_accent`, `created_by_id`, `created_at`, `updated_at`
FROM `assessments`
WHERE `logo_data` IS NOT NULL OR `theme_primary` IS NOT NULL OR `theme_accent` IS NOT NULL;
--> statement-breakpoint
UPDATE `assessments` SET `client_id` = `id` WHERE `id` IN (SELECT `id` FROM `clients`);