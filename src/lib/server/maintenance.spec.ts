import { describe, expect, it } from 'vitest';
import { createTestDb } from './db/test-db';
import { adminSessions, adminUsers, authAttempts } from './db/schema';
import { createAdminSession } from './auth/admin-session';
import { runMaintenance } from './maintenance';

describe('mantenimiento', () => {
	it('borra sesiones vencidas e intentos antiguos, conserva lo vigente', () => {
		const db = createTestDb();
		const now = new Date('2026-11-10T12:00:00Z');
		const adminId = db
			.insert(adminUsers)
			.values({ email: 'a@b.co', name: 'Admin', passwordHash: 'x' })
			.returning()
			.get().id;
		createAdminSession(db, adminId, 1, new Date('2026-11-01T00:00:00Z')); // vencida
		createAdminSession(db, adminId, 12, now); // vigente
		db.insert(authAttempts)
			.values([
				{ key: 'viejo', failures: 2, windowStart: new Date('2026-11-01T00:00:00Z') },
				{ key: 'reciente', failures: 2, windowStart: now },
				{
					key: 'bloqueado',
					failures: 0,
					windowStart: new Date('2026-11-01T00:00:00Z'),
					lockedUntil: new Date('2026-11-10T12:10:00Z')
				}
			])
			.run();

		runMaintenance(db, now);

		expect(db.select().from(adminSessions).all()).toHaveLength(1);
		expect(
			db
				.select()
				.from(authAttempts)
				.all()
				.map((r) => r.key)
				.sort()
		).toEqual(['bloqueado', 'reciente']);
	});
});
