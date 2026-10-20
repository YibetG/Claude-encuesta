import { requirePublicAssessment } from '#lib/server/participant-route.ts';
import { logoUrl } from '#lib/server/logo.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const a = requirePublicAssessment(params.slug);
	return { title: a.title, logoUrl: logoUrl(a) };
};
