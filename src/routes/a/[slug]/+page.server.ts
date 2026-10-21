import { fail, redirect } from '@sveltejs/kit';
import { PARTICIPANT_SESSION_HOURS } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { enterSchema } from '#lib/schemas/access.ts';
import {
	availability,
	enterAssessment,
	getParticipantContext
} from '#lib/server/services/access.ts';
import {
	createParticipantSession,
	deleteExpiredParticipantSessions,
	PARTICIPANT_SESSION_COOKIE,
	setParticipantCookie
} from '#lib/server/auth/participant-session.ts';
import { requirePublicAssessment } from '#lib/server/participant-route.ts';
import { lockMessage } from '#lib/server/security/rate-limit.ts';
import { formatLongDateTime } from '#lib/format.ts';
import { participantBrand } from '#lib/server/logo.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, cookies }) => {
	const a = requirePublicAssessment(params.slug);

	// Si ya tiene una sesión válida, continúa donde quedó.
	const ctx = getParticipantContext(db, {
		token: cookies.get(PARTICIPANT_SESSION_COOKIE),
		slug: a.slug,
		sessionHours: PARTICIPANT_SESSION_HOURS
	});
	if (ctx.kind === 'ok') redirect(303, `/a/${a.slug}/responder`);

	return {
		// Solo datos públicos del assessment.
		assessment: {
			title: a.title,
			description: a.description,
			accessMode: a.accessMode,
			startsAt: a.startsAt,
			endsAt: a.endsAt,
			timezone: a.timezone,
			...participantBrand(db, a)
		},
		availability: availability(a)
	};
};

export const actions: Actions = {
	default: async ({ request, params, cookies, getClientAddress }) => {
		const a = requirePublicAssessment(params.slug);
		const form = await request.formData();
		const values = { email: String(form.get('email') ?? ''), name: String(form.get('name') ?? '') };
		const parsed = enterSchema.safeParse({ ...values, password: form.get('password') });
		if (!parsed.success) {
			return fail(400, {
				values,
				error: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
				needName: false
			});
		}

		const result = await enterAssessment(db, {
			assessment: a,
			...parsed.data,
			ip: getClientAddress()
		});

		if (!result.ok) {
			const tz = a.timezone;
			const messages: Record<string, string> = {
				invalid_password: 'La contraseña de acceso no es correcta.',
				not_invited:
					'Este email no está en la lista de invitados. Use el mismo correo en el que recibió la invitación.',
				name_required: 'Es su primer ingreso: escriba su nombre para registrarse.',
				no_disponible: 'Este assessment no está disponible.',
				no_iniciado: `Aún no está disponible. Podrá ingresar desde el ${formatLongDateTime(a.startsAt, tz)}.`,
				cerrado: 'Este assessment ya cerró.'
			};
			let message = messages[result.reason] ?? 'No fue posible ingresar.';
			if (result.reason === 'locked') message = lockMessage(result.until);
			if (result.reason === 'already_submitted') {
				message = `Este email ya entregó sus respuestas el ${formatLongDateTime(result.submittedAt, tz)}. Solo se permite una entrega por persona.`;
			}
			const status = result.reason === 'locked' ? 429 : 400;
			return fail(status, { values, error: message, needName: result.reason === 'name_required' });
		}

		deleteExpiredParticipantSessions(db);
		const { token, expiresAt } = createParticipantSession(
			db,
			result.participantId,
			PARTICIPANT_SESSION_HOURS
		);
		setParticipantCookie(cookies, a.slug, token, expiresAt);
		redirect(303, `/a/${a.slug}/responder`);
	}
};
