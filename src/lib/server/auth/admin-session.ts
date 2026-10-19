import { eq, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import type { DB } from '../db/client';
import { adminSessions, adminUsers } from '../db/schema';
import { generateToken, hashToken } from './tokens';
import { SESSION_COOKIE_OPTIONS } from './cookies';

export const ADMIN_SESSION_COOKIE = 'admin_session';

export type SessionAdmin = { id: string; email: string; name: string };

const HOUR = 60 * 60 * 1000;
/** Vida máxima de una sesión de administrador, aunque se use continuamente (7 días). */
export const MAX_SESSION_HOURS = 7 * 24;

/** Crea una sesión y devuelve el token (va solo en la cookie, nunca en la base). */
export function createAdminSession(db: DB, adminId: string, hours: number, now = new Date()) {
	const token = generateToken();
	const expiresAt = new Date(now.getTime() + hours * HOUR);
	db.insert(adminSessions)
		.values({ id: hashToken(token), adminId, expiresAt, createdAt: now })
		.run();
	return { token, expiresAt };
}

/**
 * Valida el token de la cookie. Si la sesión venció la borra.
 * Expiración deslizante: si ya pasó la mitad de su vida, se extiende.
 */
export function validateAdminSession(db: DB, token: string, hours: number, now = new Date()) {
	const id = hashToken(token);
	const row = db
		.select({
			expiresAt: adminSessions.expiresAt,
			createdAt: adminSessions.createdAt,
			admin: { id: adminUsers.id, email: adminUsers.email, name: adminUsers.name }
		})
		.from(adminSessions)
		.innerJoin(adminUsers, eq(adminSessions.adminId, adminUsers.id))
		.where(eq(adminSessions.id, id))
		.get();

	if (!row) return null;

	// Además del vencimiento por inactividad, una sesión nunca dura más de MAX_SESSION_HOURS.
	const absoluteEnd = row.createdAt.getTime() + MAX_SESSION_HOURS * HOUR;
	if (row.expiresAt.getTime() <= now.getTime() || absoluteEnd <= now.getTime()) {
		db.delete(adminSessions).where(eq(adminSessions.id, id)).run();
		return null;
	}

	let expiresAt = row.expiresAt;
	if (expiresAt.getTime() - now.getTime() < (hours * HOUR) / 2) {
		expiresAt = new Date(Math.min(now.getTime() + hours * HOUR, absoluteEnd));
		db.update(adminSessions).set({ expiresAt }).where(eq(adminSessions.id, id)).run();
	}

	return { admin: row.admin satisfies SessionAdmin, expiresAt };
}

export function invalidateAdminSession(db: DB, token: string): void {
	db.delete(adminSessions)
		.where(eq(adminSessions.id, hashToken(token)))
		.run();
}

/** Cierra todas las sesiones de un admin (ej. al cambiar su contraseña). */
export function invalidateAllAdminSessions(db: DB, adminId: string): void {
	db.delete(adminSessions).where(eq(adminSessions.adminId, adminId)).run();
}

export function deleteExpiredAdminSessions(db: DB, now = new Date()): void {
	db.delete(adminSessions).where(lt(adminSessions.expiresAt, now)).run();
}

export function setAdminSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(ADMIN_SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, expires: expiresAt });
}

export function deleteAdminSessionCookie(cookies: Cookies): void {
	cookies.delete(ADMIN_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
}
