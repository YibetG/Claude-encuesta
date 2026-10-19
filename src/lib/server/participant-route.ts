import { error, redirect, type Cookies } from '@sveltejs/kit';
import { PARTICIPANT_SESSION_HOURS } from '$app/env/private';
import { db } from './db/index';
import { getAssessmentBySlug, getParticipantContext } from './services/access';
import { PARTICIPANT_SESSION_COOKIE, setParticipantCookie } from './auth/participant-session';

/** Assessment público por slug. Los no publicados se tratan como inexistentes. */
export function requirePublicAssessment(slug: string) {
	const a = getAssessmentBySlug(db, slug);
	if (!a || a.status === 'borrador') error(404, 'Este assessment no existe o no está disponible.');
	return a;
}

/**
 * Contexto del participante para /a/[slug]/responder. Se llama en el `load` y en
 * CADA acción: si algo no cuadra (sin sesión, ya entregó, fuera de fechas) redirige.
 * Con actividad, la sesión se renueva y la cookie se reenvía con el nuevo vencimiento.
 */
export function requireParticipant(cookies: Cookies, slug: string) {
	const token = cookies.get(PARTICIPANT_SESSION_COOKIE);
	const ctx = getParticipantContext(db, { token, slug, sessionHours: PARTICIPANT_SESSION_HOURS });
	if (ctx.kind === 'ok') {
		setParticipantCookie(cookies, slug, token!, ctx.sessionExpiresAt);
		return ctx;
	}
	if (ctx.kind === 'entregado') redirect(303, `/a/${slug}/entregado`);
	redirect(303, `/a/${slug}`);
}
