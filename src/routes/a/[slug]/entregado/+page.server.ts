import { requirePublicAssessment } from '#lib/server/participant-route.ts';
import { logoUrl } from '#lib/server/logo.ts';
import { themeStyle } from '#lib/theme.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const a = requirePublicAssessment(params.slug);
	return {
		title: a.title,
		logoUrl: logoUrl(a),
		themeStyle: themeStyle({ primary: a.themePrimary, accent: a.themeAccent }) ?? null
	};
};
