import { db } from '#lib/server/db/index.ts';
import { listAssessments } from '#lib/server/services/assessments.ts';
import { buildReport } from '#lib/server/services/reports.ts';
import { logoUrl } from '#lib/server/logo.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const includeArchived = url.searchParams.get('archivados') === '1';
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

	const all = listAssessments(db, { includeArchived }).map((a) => ({
		...a,
		logoUrl: logoUrl(a),
		// La alineación solo se calcula si hay entregas (evita trabajo inútil).
		averageAlignment: a.submittedCount ? buildReport(db, a.id).summary.averageAlignment : null
	}));
	const assessments = q ? all.filter((a) => a.title.toLowerCase().includes(q)) : all;

	const active = all.filter((a) => a.status !== 'archivado');
	const sum = (f: (a: (typeof all)[number]) => number) => active.reduce((s, a) => s + f(a), 0);
	const withAlignment = active.filter((a) => a.averageAlignment !== null);
	const participants = sum((a) => a.participantCount);

	return {
		includeArchived,
		q,
		assessments,
		kpis: {
			published: active.filter((a) => a.status === 'publicado').length,
			drafts: active.filter((a) => a.status === 'borrador').length,
			submitted: sum((a) => a.submittedCount),
			inProgress: sum((a) => a.inProgressCount),
			participants,
			participationRate: participants ? sum((a) => a.submittedCount) / participants : null,
			averageAlignment: withAlignment.length
				? withAlignment.reduce((s, a) => s + a.averageAlignment!, 0) / withAlignment.length
				: null,
			alignmentCount: withAlignment.length
		}
	};
};
