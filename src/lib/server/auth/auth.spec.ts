import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { adminSessions, adminUsers } from '../db/schema';
import { hashPassword, verifyPassword } from './password';
import { hashToken } from './tokens';
import {
	createAdminSession,
	invalidateAdminSession,
	invalidateAllAdminSessions,
	validateAdminSession
} from './admin-session';
import { safeAdminRedirect } from './redirect';

const HOUR = 60 * 60 * 1000;

describe('contraseñas (Argon2id)', () => {
	it('verifica la contraseña correcta y rechaza otra', async () => {
		const hash = await hashPassword('clave-super-segura');
		expect(hash).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword(hash, 'clave-super-segura')).toBe(true);
		expect(await verifyPassword(hash, 'otra-clave')).toBe(false);
	});

	it('devuelve false con un hash inválido en vez de lanzar error', async () => {
		expect(await verifyPassword('no-es-un-hash', 'x')).toBe(false);
	});
});

describe('sesiones de administrador', () => {
	let db: ReturnType<typeof createTestDb>;
	let adminId: string;

	beforeEach(() => {
		db = createTestDb();
		adminId = db
			.insert(adminUsers)
			.values({ email: 'ana@ejemplo.com', name: 'Ana', passwordHash: 'x' })
			.returning()
			.get().id;
	});

	it('guarda solo el hash del token y valida la sesión', () => {
		const now = new Date('2026-05-01T10:00:00Z');
		const { token } = createAdminSession(db, adminId, 12, now);

		const stored = db.select().from(adminSessions).get()!;
		expect(stored.id).toBe(hashToken(token));
		expect(stored.id).not.toBe(token);

		const session = validateAdminSession(db, token, 12, now);
		expect(session?.admin).toEqual({ id: adminId, email: 'ana@ejemplo.com', name: 'Ana' });
	});

	it('rechaza un token desconocido', () => {
		expect(validateAdminSession(db, 'token-inventado', 12)).toBeNull();
	});

	it('rechaza y elimina una sesión vencida', () => {
		const now = new Date('2026-05-01T10:00:00Z');
		const { token } = createAdminSession(db, adminId, 12, now);
		const later = new Date(now.getTime() + 13 * HOUR);
		expect(validateAdminSession(db, token, 12, later)).toBeNull();
		expect(db.select().from(adminSessions).all()).toHaveLength(0);
	});

	it('extiende la sesión cuando ya pasó la mitad de su duración', () => {
		const now = new Date('2026-05-01T10:00:00Z');
		const { token, expiresAt } = createAdminSession(db, adminId, 12, now);

		const early = validateAdminSession(db, token, 12, new Date(now.getTime() + 2 * HOUR));
		expect(early?.expiresAt).toEqual(expiresAt);

		const late = new Date(now.getTime() + 7 * HOUR);
		const renewed = validateAdminSession(db, token, 12, late);
		expect(renewed?.expiresAt).toEqual(new Date(late.getTime() + 12 * HOUR));
	});

	it('una sesión usada sin parar igual vence a los 7 días', () => {
		const start = new Date('2026-05-01T10:00:00Z');
		const { token } = createAdminSession(db, adminId, 12, start);
		// Uso cada 5 horas: la expiración deslizante la mantiene viva…
		let t = start.getTime();
		for (let i = 0; i < 33; i++) {
			t += 5 * HOUR;
			expect(validateAdminSession(db, token, 12, new Date(t))).not.toBeNull();
		}
		// …pero nunca más allá de 7 días desde que se creó.
		expect(
			validateAdminSession(db, token, 12, new Date(start.getTime() + 7 * 24 * HOUR))
		).toBeNull();
	});

	it('cierra una sesión o todas las del admin', () => {
		const a = createAdminSession(db, adminId, 12);
		const b = createAdminSession(db, adminId, 12);
		invalidateAdminSession(db, a.token);
		expect(validateAdminSession(db, a.token, 12)).toBeNull();
		expect(validateAdminSession(db, b.token, 12)).not.toBeNull();
		invalidateAllAdminSessions(db, adminId);
		expect(validateAdminSession(db, b.token, 12)).toBeNull();
	});
});

describe('safeAdminRedirect', () => {
	it.each([
		['/admin', '/admin'],
		['/admin/assessments/123?tab=reportes', '/admin/assessments/123?tab=reportes'],
		[null, '/admin'],
		['https://malicioso.com', '/admin'],
		['//malicioso.com/admin', '/admin'],
		['/admin\\..\\x', '/admin'],
		['/administrador-falso', '/admin'],
		['/admin/login', '/admin'],
		['/a/slug', '/admin']
	])('%s → %s', (input, expected) => {
		expect(safeAdminRedirect(input)).toBe(expected);
	});
});
