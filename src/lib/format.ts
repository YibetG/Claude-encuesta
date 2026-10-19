// Formato de fechas para la interfaz (español, zona horaria explícita).

export const DEFAULT_TIMEZONE = 'America/Bogota';

export function formatDateTime(date: Date | number, timeZone = DEFAULT_TIMEZONE): string {
	return new Intl.DateTimeFormat('es-CO', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone
	}).format(date);
}
