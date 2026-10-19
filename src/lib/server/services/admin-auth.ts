import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { adminUsers } from '../db/schema';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password';
import { invalidateAllAdminSessions, type SessionAdmin } from '../auth/admin-session';
import { clearFailures, limitKeys, lockedUntil, recordFailure } from '../security/rate-limit';
import { audit } from '../security/audit';
import type { CreateAdminInput } from '../../schemas/admin';

export const ADMIN_LOGIN_SCOPE = 'admin-login';

export type LoginResult =
	| { ok: true; admin: SessionAdmin }
	| { ok: false; reason: 'invalid' }
	| { ok: false; reason: 'locked'; until: Date };

/**
 * Verifica las credenciales del administrador aplicando rate limiting por IP y por email.
 * No distingue "email inexistente" de "contraseña incorrecta" para no revelar cuentas.
 */
export async function authenticateAdmin(
	db: DB,
	input: { email: string; password: string; ip: string },
	now = new Date()
): Promise<LoginResult> {
	const keys = limitKeys(ADMIN_LOGIN_SCOPE, input.ip, input.email);

	const blocked = lockedUntil(db, keys, now);
	if (blocked) return { ok: false, reason: 'locked', until: blocked };

	const user = db.select().from(adminUsers).where(eq(adminUsers.email, input.email)).get();
	// Siempre se ejecuta una verificación Argon2 para que el tiempo de respuesta sea parejo.
	const valid = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);

	if (!user || !valid) {
		const lockedNow = recordFailure(db, keys, now);
		audit(db, {
			adminId: user?.id ?? null,
			action: 'admin.login_fallido',
			metadata: { email: input.email },
			ip: input.ip
		});
		return lockedNow
			? { ok: false, reason: 'locked', until: lockedNow }
			: { ok: false, reason: 'invalid' };
	}

	// Éxito: se limpia el contador del email (el de la IP se deja correr su ventana).
	clearFailures(db, [keys[1].key]);
	db.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, user.id)).run();
	audit(db, { adminId: user.id, action: 'admin.login', ip: input.ip });

	return { ok: true, admin: { id: user.id, email: user.email, name: user.name } };
}

export class AdminExistsError extends Error {
	constructor(email: string) {
		super(`Ya existe un administrador con el email ${email}`);
	}
}

/** Crea un administrador. La entrada ya debe venir validada con `createAdminSchema`. */
export async function createAdmin(db: DB, input: CreateAdminInput): Promise<SessionAdmin> {
	const exists = db
		.select({ id: adminUsers.id })
		.from(adminUsers)
		.where(eq(adminUsers.email, input.email))
		.get();
	if (exists) throw new AdminExistsError(input.email);

	const [admin] = db
		.insert(adminUsers)
		.values({
			email: input.email,
			name: input.name,
			passwordHash: await hashPassword(input.password)
		})
		.returning({ id: adminUsers.id, email: adminUsers.email, name: adminUsers.name })
		.all();

	audit(db, {
		adminId: null,
		action: 'admin.creado',
		entityType: 'admin',
		entityId: admin.id,
		metadata: { email: admin.email, origen: 'terminal' }
	});
	return admin;
}

/** Cambia la contraseña de un admin y cierra todas sus sesiones abiertas. */
export async function resetAdminPassword(
	db: DB,
	email: string,
	password: string
): Promise<boolean> {
	const user = db
		.select({ id: adminUsers.id })
		.from(adminUsers)
		.where(eq(adminUsers.email, email))
		.get();
	if (!user) return false;

	db.update(adminUsers)
		.set({ passwordHash: await hashPassword(password) })
		.where(eq(adminUsers.id, user.id))
		.run();
	invalidateAllAdminSessions(db, user.id);
	audit(db, {
		adminId: null,
		action: 'admin.password_cambiada',
		entityType: 'admin',
		entityId: user.id,
		metadata: { origen: 'terminal' }
	});
	return true;
}
