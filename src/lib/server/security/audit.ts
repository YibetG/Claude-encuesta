import type { Executor } from '../db/client';
import { auditLog } from '../db/schema';

/**
 * Acciones registradas en la auditoría. Mantener la lista cerrada evita errores
 * de escritura y permite traducirlas en la pantalla de auditoría.
 */
export const AUDIT_ACTIONS = {
	'admin.login': 'Inicio de sesión',
	'admin.login_fallido': 'Intento de inicio de sesión fallido',
	'admin.logout': 'Cierre de sesión',
	'admin.creado': 'Administrador creado',
	'admin.password_cambiada': 'Contraseña de administrador cambiada',
	'assessment.creado': 'Assessment creado',
	'assessment.editado': 'Assessment editado',
	'assessment.duplicado': 'Assessment duplicado',
	'assessment.archivado': 'Assessment archivado',
	'assessment.password_cambiada': 'Contraseña de acceso cambiada',
	'assessment.password_vista': 'Contraseña de acceso consultada',
	'preguntas.editadas': 'Preguntas editadas',
	'preguntas.importadas': 'Preguntas importadas',
	'participantes.cargados': 'Participantes cargados',
	'participantes.eliminado': 'Participante eliminado',
	'invitaciones.enviadas': 'Invitaciones enviadas',
	'reporte.exportado': 'Reporte exportado',
	'ia.analisis': 'Análisis con IA ejecutado'
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export type AuditEntry = {
	adminId: string | null;
	action: AuditAction;
	entityType?: string;
	entityId?: string;
	metadata?: Record<string, unknown>;
	ip?: string | null;
};

export function audit(db: Executor, entry: AuditEntry): void {
	db.insert(auditLog)
		.values({
			adminId: entry.adminId,
			action: entry.action,
			entityType: entry.entityType ?? null,
			entityId: entry.entityId ?? null,
			metadata: entry.metadata ?? null,
			ip: entry.ip ?? null
		})
		.run();
}
