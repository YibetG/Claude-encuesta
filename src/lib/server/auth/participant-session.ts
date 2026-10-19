import { eq, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import type { DB } from '../db/client';
import { participantSessions } from '../db/schema';
import { generateToken, hashToken } from './tokens';
import { SESSION_COOKIE_OPTIONS } from './cookies';

// Sesión del participante: se crea al validar contraseña + email y permite guardar
// borradores y volver más tarde. La cookie se limita a la ruta del assessment
// (/a/[slug]), así una persona puede tener sesiones en varios assessments a la vez.

export const PARTICIPANT_SESSION_COOKIE = 'participant_session';
const HOUR = 60 * 60 * 1000;

export function createParticipantSession(
	db: DB,
	participantId: string,
	hours: number,
	now = new Date()
) {
	const token = generateToken();
	const expiresAt = new Date(now.getTime() + hours * HOUR);
	db.insert(participantSessions)
		.values({ id: hashToken(token), participantId, expiresAt })
		.run();
	return { token, expiresAt };
}

/** Devuelve el participante de la sesión (y renueva el vencimiento), o `null`. */
export function validateParticipantSession(db: DB, token: string, hours: number, now = new Date()) {
	const id = hashToken(token);
	const row = db.select().from(participantSessions).where(eq(participantSessions.id, id)).get();
	if (!row) return null;

	if (row.expiresAt <= now) {
		db.delete(participantSessions).where(eq(participantSessions.id, id)).run();
		return null;
	}

	let expiresAt = row.expiresAt;
	if (expiresAt.getTime() - now.getTime() < (hours * HOUR) / 2) {
		expiresAt = new Date(now.getTime() + hours * HOUR);
		db.update(participantSessions).set({ expiresAt }).where(eq(participantSessions.id, id)).run();
	}
	return { participantId: row.participantId, expiresAt };
}

export function invalidateParticipantSessions(db: DB, participantId: string) {
	db.delete(participantSessions).where(eq(participantSessions.participantId, participantId)).run();
}

export function deleteExpiredParticipantSessions(db: DB, now = new Date()) {
	db.delete(participantSessions).where(lt(participantSessions.expiresAt, now)).run();
}

const cookiePath = (slug: string) => `/a/${slug}`;

export function setParticipantCookie(
	cookies: Cookies,
	slug: string,
	token: string,
	expiresAt: Date
) {
	cookies.set(PARTICIPANT_SESSION_COOKIE, token, {
		...SESSION_COOKIE_OPTIONS,
		path: cookiePath(slug),
		expires: expiresAt
	});
}

export function deleteParticipantCookie(cookies: Cookies, slug: string) {
	cookies.delete(PARTICIPANT_SESSION_COOKIE, { ...SESSION_COOKIE_OPTIONS, path: cookiePath(slug) });
}
