import { db } from '#lib/server/db/index.ts';
import { listAssessments } from '#lib/server/services/assessments.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const includeArchived = url.searchParams.get('archivados') === '1';
	return { includeArchived, assessments: listAssessments(db, { includeArchived }) };
};
