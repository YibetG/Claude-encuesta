import { count, eq } from 'drizzle-orm';
import { APP_URL } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { participants } from '#lib/server/db/schema.ts';
import { countQuestions } from '#lib/server/services/assessments.ts';
import { questionsLockReason } from '#lib/server/services/questions.ts';
import { seriesMembers } from '#lib/server/services/series.ts';
import { publicLink } from '#lib/server/services/invitations.ts';
import { logoUrl } from '#lib/server/logo.ts';
import { getBrand } from '#lib/server/services/clients.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params }) => {
	const a = requireAssessment(params.id);
	const brand = getBrand(db, a.clientId);
	const lockReason = questionsLockReason(db, a.id);
	const members = seriesMembers(db, a);

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
			// Marca heredada del cliente.
			client: brand
				? {
						id: brand.id,
						name: brand.name,
						themePrimary: brand.themePrimary,
						themeAccent: brand.themeAccent
					}
				: null,
			logoUrl: logoUrl(a.slug, brand)
		},
		lockReason,
		locked: lockReason !== null,
		// Serie de mediciones (solo si hay más de una): para la pestaña Mediciones.
		series:
			members.length > 1
				? members.map((m) => ({ id: m.id, title: m.title, order: m.seriesOrder, status: m.status }))
				: null,
		questionCounts: countQuestions(db, a.id),
		participantCount:
			db.select({ n: count() }).from(participants).where(eq(participants.assessmentId, a.id)).get()
				?.n ?? 0,
		publicLink: publicLink(APP_URL, a.slug)
	};
};
