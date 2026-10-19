import { db } from '#lib/server/db/index.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import { buildReport } from '#lib/server/services/reports.ts';
import { distinctAreasAndCargos } from '#lib/server/services/participants.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const a = requireAssessment(params.id);
	const { areas, cargos } = distinctAreasAndCargos(db, a.id);

	// Solo se aceptan valores que existen (evita filtros arbitrarios en la URL).
	const area = url.searchParams.get('area');
	const cargo = url.searchParams.get('cargo');
	const filters = {
		area: area && areas.includes(area) ? area : null,
		cargo: cargo && cargos.includes(cargo) ? cargo : null
	};

	return { report: buildReport(db, a.id, filters), areas, cargos };
};
