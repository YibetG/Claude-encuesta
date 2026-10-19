import { requirePublicAssessment } from '#lib/server/participant-route.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const a = requirePublicAssessment(params.slug);
	return { title: a.title };
};
