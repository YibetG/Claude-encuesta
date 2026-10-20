import { defineEnvVars } from '@sveltejs/kit/env';

// Variables de entorno de la aplicación. Se validan al iniciar el servidor.
// Todas son privadas (solo servidor): ninguna llega al navegador.
// Ver `.env.example` para la documentación de cada una.

/** Variable obligatoria que no puede quedar vacía. */
const required = (name: string) => (value: string | undefined) => {
	if (!value?.trim()) throw new Error(`${name} es obligatoria`);
	return value.trim();
};

/** Variable opcional: devuelve `undefined` si está vacía. */
const optional = (value: string | undefined) => value?.trim() || undefined;

/** Texto con valor por defecto. */
const withDefault = (fallback: string) => (value: string | undefined) => value?.trim() || fallback;

/** Entero positivo con valor por defecto. */
const positiveInt = (name: string, fallback: number) => (value: string | undefined) => {
	if (!value?.trim()) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} debe ser un entero positivo`);
	return n;
};

const bool = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Ruta del archivo SQLite (ej. data/app.db).',
		schema: required('DATABASE_URL')
	},
	APP_URL: {
		description: 'URL pública de la app, usada para armar los links de invitación.',
		schema: withDefault('http://localhost:5173')
	},
	ADMIN_SESSION_HOURS: {
		description: 'Duración de la sesión del administrador (horas, se renueva con el uso).',
		schema: positiveInt('ADMIN_SESSION_HOURS', 12)
	},
	PARTICIPANT_SESSION_HOURS: {
		description: 'Duración de la sesión del participante (horas, se renueva con el uso).',
		schema: positiveInt('PARTICIPANT_SESSION_HOURS', 72)
	},
	ACCESS_PASSWORD_KEY: {
		description:
			'Clave (64 hex) para cifrar las contraseñas de acceso. Si falta, se crea un archivo junto a la base.',
		schema: optional
	},
	ANTHROPIC_API_KEY: {
		description: 'API key de Anthropic. Si falta, el análisis con IA queda deshabilitado.',
		schema: optional
	},
	ANTHROPIC_MODEL: {
		description: 'Modelo de Claude para el análisis de respuestas abiertas.',
		schema: withDefault('claude-opus-5-5')
	},
	AI_TIMEOUT_MS: {
		description: 'Tiempo máximo de espera por llamada a la IA (milisegundos).',
		schema: positiveInt('AI_TIMEOUT_MS', 180_000)
	},
	SMTP_HOST: {
		description: 'Servidor SMTP. Si falta, los correos se muestran en la consola.',
		schema: optional
	},
	SMTP_PORT: {
		description: 'Puerto SMTP (Mailpit usa 1025).',
		schema: positiveInt('SMTP_PORT', 1025)
	},
	SMTP_SECURE: {
		description: '"true" para usar TLS directo (puerto 465).',
		schema: bool
	},
	SMTP_USER: { description: 'Usuario SMTP (opcional).', schema: optional },
	SMTP_PASS: { description: 'Contraseña SMTP (opcional).', schema: optional },
	MAIL_FROM: {
		description: 'Remitente de los correos.',
		schema: withDefault('Assessments <no-reply@localhost>')
	}
});
