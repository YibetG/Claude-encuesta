import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { adminUsers, auditLog } from '../db/schema';
import { AdminExistsError, authenticateAdmin, createAdmin, resetAdminPassword } from './admin-auth';
import { createAdminSession, validateAdminSession } from '../auth/admin-session';
import { createAdminSchema } from '../../schemas/admin';

const PASSWORD = 'clave-de-prueba-123';
let db: ReturnType<typeof createTestDb>;

beforeEach(async () => {
	db = createTestDb();
	await createAdmin(db, { email: 'ana@ejemplo.com', name: 'Ana', password: PASSWORD });
});

const login = (email: string, password: string, ip = '10.0.0.1', now?: Date) =>
	authenticateAdmin(db, { email, password, ip }, now);

// Argon2 es lento a propósito: se da margen a estas pruebas.
describe('authenticateAdmin', { timeout: 30_000 }, () => {
	it('ingresa con credenciales correctas y lo registra en auditoría', async () => {
		const r = await login('ana@ejemplo.com', PASSWORD);
		expect(r).toMatchObject({ ok: true, admin: { email: 'ana@ejemplo.com', name: 'Ana' } });
		expect(db.select().from(adminUsers).get()?.lastLoginAt).toBeInstanceOf(Date);
		expect(
			db
				.select()
				.from(auditLog)
				.all()
				.map((a) => a.action)
		).toContain('admin.login');
	});

	it('responde igual para contraseña incorrecta y email inexistente', async () => {
		expect(await login('ana@ejemplo.com', 'incorrecta')).toEqual({ ok: false, reason: 'invalid' });
		expect(await login('nadie@ejemplo.com', PASSWORD)).toEqual({ ok: false, reason: 'invalid' });
		const fallidos = db
			.select()
			.from(auditLog)
			.all()
			.filter((a) => a.action === 'admin.login_fallido');
		expect(fallidos).toHaveLength(2);
	});

	it('bloquea tras 5 fallos, incluso con la contraseña correcta', async () => {
		for (let i = 0; i < 4; i++) await login('ana@ejemplo.com', 'mal');
		const fifth = await login('ana@ejemplo.com', 'mal');
		expect(fifth).toMatchObject({ ok: false, reason: 'locked' });
		expect(await login('ana@ejemplo.com', PASSWORD)).toMatchObject({ ok: false, reason: 'locked' });
	});

	it('intentos simultáneos no esquivan el bloqueo (sin carrera)', async () => {
		const results = await Promise.all(
			Array.from({ length: 12 }, (_, i) => login('ana@ejemplo.com', `mal-${i}`))
		);
		const invalid = results.filter((r) => !r.ok && r.reason === 'invalid').length;
		// Solo 4 llegan a verificarse como "incorrecta"; el 5.º bloquea y el resto ve el bloqueo.
		expect(invalid).toBe(4);
		expect(results.filter((r) => !r.ok && r.reason === 'locked')).toHaveLength(8);
	});

	it('un ingreso exitoso reinicia el contador del email', async () => {
		for (let i = 0; i < 4; i++) await login('ana@ejemplo.com', 'mal');
		expect((await login('ana@ejemplo.com', PASSWORD)).ok).toBe(true);
		for (let i = 0; i < 4; i++) await login('ana@ejemplo.com', 'mal');
		expect(await login('ana@ejemplo.com', 'mal')).toMatchObject({ reason: 'locked' });
	});
});

describe('createAdmin / resetAdminPassword', () => {
	it('no permite emails duplicados', async () => {
		await expect(
			createAdmin(db, { email: 'ana@ejemplo.com', name: 'Otra', password: PASSWORD })
		).rejects.toBeInstanceOf(AdminExistsError);
	});

	it('cambiar la contraseña cierra las sesiones abiertas', async () => {
		const admin = db.select().from(adminUsers).get()!;
		const { token } = createAdminSession(db, admin.id, 12);
		expect(await resetAdminPassword(db, 'ana@ejemplo.com', 'nueva-clave-segura')).toBe(true);
		expect(validateAdminSession(db, token, 12)).toBeNull();
		expect((await login('ana@ejemplo.com', 'nueva-clave-segura')).ok).toBe(true);
	});

	it('la validación normaliza el email y exige 10 caracteres', () => {
		const ok = createAdminSchema.safeParse({
			email: '  Ana@Ejemplo.COM ',
			name: 'Ana',
			password: '1234567890'
		});
		expect(ok.success && ok.data.email).toBe('ana@ejemplo.com');
		const corta = createAdminSchema.safeParse({ email: 'a@b.co', name: 'Ana', password: 'corta' });
		expect(corta.success).toBe(false);
	});
});
