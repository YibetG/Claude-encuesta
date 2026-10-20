import { count, eq } from 'drizzle-orm';
import { APP_URL } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { participants } from '#lib/server/db/schema.ts';
import { countQuestions, hasResponses } from '#lib/server/services/assessments.ts';
import { publicLink } from '#lib/server/services/invitations.ts';
import { logoUrl } from '#lib/server/logo.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params }) => {
	const a = requireAssessment(params.id);

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
			hasPassword: !!a.accessPasswordHash,
			// Solo si se puede descifrar: la contraseña en sí se pide aparte (y queda en auditoría).
			passwordViewable: !!a.accessPasswordEnc,
			logoUrl: logoUrl(a),
			themePrimary: a.themePrimary,
			themeAccent: a.themeAccent
		},
		locked: hasResponses(db, a.id),
		questionCounts: countQuestions(db, a.id),
		participantCount:
			db.select({ n: count() }).from(participants).where(eq(participants.assessmentId, a.id)).get()
				?.n ?? 0,
		publicLink: publicLink(APP_URL, a.slug)
	};
};
