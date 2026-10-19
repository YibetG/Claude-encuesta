import {
	MAIL_FROM,
	SMTP_HOST,
	SMTP_PASS,
	SMTP_PORT,
	SMTP_SECURE,
	SMTP_USER
} from '$app/env/private';
import { createMailer } from './mailer';

/** Transporte de correo de la aplicación, configurado desde `.env`. */
export const mailer = createMailer({
	host: SMTP_HOST,
	port: SMTP_PORT,
	secure: SMTP_SECURE,
	user: SMTP_USER,
	pass: SMTP_PASS,
	from: MAIL_FROM
});
