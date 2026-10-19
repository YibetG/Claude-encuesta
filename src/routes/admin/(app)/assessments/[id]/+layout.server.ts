import { error } from '@sveltejs/kit';
import { APP_URL } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { countQuestions, getAssessment, hasResponses } from '#lib/server/services/assessments.ts';
import { assertUuid } from '#lib/server/forms.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params }) => {
	assertUuid(params.id);
	const a = getAssessment(db, params.id);
	if (!a) error(404, 'Assessment no encontrado');

	return {
		// Campos explícitos: el hash de la contraseña de acceso nunca sale del servidor.
		assessment: {
			id: a.id,
			title: a.title,
			status: a.status,
			slug: a.slug,
			timezone: a.timezone,
			accessMode: a.accessMode,
			openMaxChars: a.openMaxChars,
			startsAt: a.startsAt,
			endsAt: a.endsAt,
			hasPassword: !!a.accessPasswordHash
		},
		locked: hasResponses(db, a.id),
		questionCounts: countQuestions(db, a.id),
		publicLink: `${APP_URL.replace(/\/$/, '')}/a/${a.slug}`
	};
};
