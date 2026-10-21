import { db } from '#lib/server/db/index.ts';
import { requireClient } from '#lib/server/route-helpers.ts';
import { buildClientReport } from '#lib/server/services/client-report.ts';
import { clientLogoUrl } from '#lib/server/logo.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const c = requireClient(params.id);
	return {
		client: { id: c.id, name: c.name, logoUrl: clientLogoUrl(c) },
		report: buildClientReport(db, c.id)
	};
};
