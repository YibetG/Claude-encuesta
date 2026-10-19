import type { Assessment } from '../services/assessments';
import type { ReportFilters } from '../services/reports';
import { formatLongDateTime } from '../../format';

/** Datos del encabezado comunes al Excel y al PDF. */
export type ExportMeta = {
	title: string;
	description: string;
	timezone: string;
	period: string;
	generatedAt: string;
	filtersLabel: string;
};

export function exportMeta(a: Assessment, filters: ReportFilters, now = new Date()): ExportMeta {
	const parts = [
		filters.area ? `Área: ${filters.area}` : null,
		filters.cargo ? `Cargo: ${filters.cargo}` : null
	].filter(Boolean);
	return {
		title: a.title,
		description: a.description,
		timezone: a.timezone,
		period: `Del ${formatLongDateTime(a.startsAt, a.timezone)} al ${formatLongDateTime(a.endsAt, a.timezone)}`,
		generatedAt: formatLongDateTime(now, a.timezone),
		filtersLabel: parts.length ? parts.join(' · ') : 'Todos los participantes'
	};
}

/** Nombre de archivo seguro: "informe-seguridad-de-la-informacion-2026-11-05.xlsx". */
export function exportFileName(title: string, ext: 'xlsx' | 'pdf', now = new Date()): string {
	const slug =
		title
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60) || 'assessment';
	return `informe-${slug}-${now.toISOString().slice(0, 10)}.${ext}`;
}

export const STATUS_TEXT = {
	pendiente: 'Pendiente',
	en_progreso: 'En progreso',
	completado: 'Completado'
} as const;
