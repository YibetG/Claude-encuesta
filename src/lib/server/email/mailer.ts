import nodemailer from 'nodemailer';

export type MailMessage = { to: string; subject: string; text: string; html: string };

export interface Mailer {
	/** "smtp" envía de verdad; "consola" solo imprime el correo (desarrollo). */
	readonly kind: 'smtp' | 'consola';
	send(message: MailMessage): Promise<void>;
}

export type MailerConfig = {
	host?: string;
	port: number;
	secure: boolean;
	user?: string;
	pass?: string;
	from: string;
};

/** Crea el transporte según la configuración: SMTP si hay host, si no, consola. */
export function createMailer(config: MailerConfig): Mailer {
	if (!config.host) {
		return {
			kind: 'consola',
			async send(m) {
				console.info(
					[
						'──────── Correo (modo consola: configure SMTP_HOST para enviarlo) ────────',
						`De: ${config.from}`,
						`Para: ${m.to}`,
						`Asunto: ${m.subject}`,
						'',
						m.text,
						'─────────────────────────────────────────────────────────────────────────'
					].join('\n')
				);
			}
		};
	}

	const transporter = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: config.user ? { user: config.user, pass: config.pass } : undefined,
		connectionTimeout: 15_000,
		greetingTimeout: 15_000,
		socketTimeout: 30_000
	});

	return {
		kind: 'smtp',
		async send(m) {
			await transporter.sendMail({ from: config.from, ...m });
		}
	};
}
