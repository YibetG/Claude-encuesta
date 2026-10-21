import { error } from '@sveltejs/kit';
import { db } from './db/index';
import { getAssessment } from './services/assessments';
import { getClient } from './services/clients';
import { distinctAreasAndCargos } from './services/participants';
import { assertUuid } from './forms';
import type { ReportFilters } from './services/reports';

/** Carga el assessment de la URL o responde 404. */
export function requireAssessment(id: string) {
	assertUuid(id);
	const a = getAssessment(db, id);
	if (!a) error(404, 'Assessment no encontrado');
	return a;
}

/** Carga el cliente de la URL o responde 404. */
export function requireClient(id: string) {
	assertUuid(id);
	const c = getClient(db, id);
	if (!c) error(404, 'Cliente no encontrado');
	return c;
}

/**
 * Filtros de reporte (?area=…&cargo=…). Solo se aceptan valores que existen
 * en los participantes del assessment; cualquier otro valor se ignora.
 */
export function reportFiltersFromUrl(assessmentId: string, url: URL) {
	const { areas, cargos } = distinctAreasAndCargos(db, assessmentId);
	const area = url.searchParams.get('area');
	const cargo = url.searchParams.get('cargo');
	const filters: ReportFilters = {
		area: area && areas.includes(area) ? area : null,
		cargo: cargo && cargos.includes(cargo) ? cargo : null
	};
	return { filters, areas, cargos };
}
