// Formato de fechas para la interfaz (español, zona horaria explícita).

export const DEFAULT_TIMEZONE = 'America/Bogota';

/** Formato largo para textos dirigidos a personas: "1 de noviembre de 2026, 8:00 a. m." */
export function formatLongDateTime(date: Date | number, timeZone = DEFAULT_TIMEZONE): string {
	return new Intl.DateTimeFormat('es-CO', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone
	}).format(date);
}

export function formatDateTime(date: Date | number, timeZone = DEFAULT_TIMEZONE): string {
	return new Intl.DateTimeFormat('es-CO', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone
	}).format(date);
}
