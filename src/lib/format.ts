// Formato de fechas para la interfaz (español, zona horaria explícita).

export const DEFAULT_TIMEZONE = 'America/Bogota';

/** "83%" / "61,1%" con formato colombiano; "—" cuando no hay dato. */
export function formatPercent(rate: number | null, digits = 0): string {
	if (rate === null) return '—';
	return new Intl.NumberFormat('es-CO', {
		style: 'percent',
		maximumFractionDigits: digits,
		minimumFractionDigits: digits
	}).format(rate);
}

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
