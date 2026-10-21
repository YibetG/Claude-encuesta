import { db } from '#lib/server/db/index.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import { buildComparison } from '#lib/server/services/comparison.ts';
import { seriesMembers } from '#lib/server/services/series.ts';
import { comparisonParams } from '#lib/server/comparison-params.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const a = requireAssessment(params.id);
	const members = seriesMembers(db, a);
	if (members.length < 2) return { comparison: null, query: '' };
	const { mode, selectedIds } = comparisonParams(
		url,
		members.map((m) => m.id)
	);
	return {
		comparison: buildComparison(db, a, { mode, selectedIds }),
		// Para que las descargas usen el mismo modo y mediciones que la pantalla.
		query: url.search
	};
};
