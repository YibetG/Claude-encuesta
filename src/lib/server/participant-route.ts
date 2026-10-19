import { error, redirect, type Cookies } from '@sveltejs/kit';
import { PARTICIPANT_SESSION_HOURS } from '$app/env/private';
import { db } from './db/index';
import { getAssessmentBySlug, getParticipantContext } from './services/access';
import { PARTICIPANT_SESSION_COOKIE } from './auth/participant-session';

/** Assessment público por slug. Los no publicados se tratan como inexistentes. */
export function requirePublicAssessment(slug: string) {
	const a = getAssessmentBySlug(db, slug);
	if (!a || a.status === 'borrador') error(404, 'Este assessment no existe o no está disponible.');
	return a;
}

/**
 * Contexto del participante para /a/[slug]/responder. Se llama en el `load` y en
 * CADA acción: si algo no cuadra (sin sesión, ya entregó, fuera de fechas) redirige.
 */
export function requireParticipant(cookies: Cookies, slug: string) {
	const ctx = getParticipantContext(db, {
		token: cookies.get(PARTICIPANT_SESSION_COOKIE),
		slug,
		sessionHours: PARTICIPANT_SESSION_HOURS
	});
	if (ctx.kind === 'ok') return ctx;
	if (ctx.kind === 'entregado') redirect(303, `/a/${slug}/entregado`);
	redirect(303, `/a/${slug}`);
}
