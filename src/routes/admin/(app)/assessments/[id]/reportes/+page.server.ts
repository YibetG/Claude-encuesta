import { db } from '#lib/server/db/index.ts';
import { reportFiltersFromUrl, requireAssessment } from '#lib/server/route-helpers.ts';
import { buildReport } from '#lib/server/services/reports.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const a = requireAssessment(params.id);
	const { filters, areas, cargos } = reportFiltersFromUrl(a.id, url);
	// Las respuestas por participante solo se usan en las exportaciones: no se envían al navegador.
	const report = { ...buildReport(db, a.id, filters), answersByParticipant: {} };
	return { report, areas, cargos, query: url.search };
};
