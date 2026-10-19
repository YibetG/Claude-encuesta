import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { adminUsers, auditLog } from '#lib/server/db/schema.ts';
import { AUDIT_ACTIONS, type AuditAction } from '#lib/server/security/audit.ts';
import type { PageServerLoad } from './$types';

const LIMIT = 200;

export const load: PageServerLoad = () => {
	const rows = db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			entityType: auditLog.entityType,
			metadata: auditLog.metadata,
			ip: auditLog.ip,
			createdAt: auditLog.createdAt,
			adminName: adminUsers.name,
			adminEmail: adminUsers.email
		})
		.from(auditLog)
		.leftJoin(adminUsers, eq(auditLog.adminId, adminUsers.id))
		.orderBy(desc(auditLog.id))
		.limit(LIMIT)
		.all();

	return {
		limit: LIMIT,
		entries: rows.map((r) => ({
			...r,
			label: AUDIT_ACTIONS[r.action as AuditAction] ?? r.action,
			// Detalle legible y acotado (los metadatos nunca contienen contraseñas).
			detail: r.metadata
				? Object.entries(r.metadata)
						.map(([k, v]) => `${k}: ${String(v)}`)
						.join(' · ')
				: ''
		}))
	};
};
