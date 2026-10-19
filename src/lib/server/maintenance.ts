import type { DB } from './db/client';
import { deleteExpiredAdminSessions } from './auth/admin-session';
import { deleteExpiredParticipantSessions } from './auth/participant-session';
import { purgeStaleAttempts } from './security/rate-limit';

const HOUR = 60 * 60 * 1000;

/** Borra sesiones vencidas y contadores de intentos que ya no bloquean (más de un día). */
export function runMaintenance(db: DB, now = new Date()): void {
	deleteExpiredAdminSessions(db, now);
	deleteExpiredParticipantSessions(db, now);
	purgeStaleAttempts(db, 24 * HOUR, now);
}

/** Ejecuta el mantenimiento al iniciar y luego cada hora (sin impedir que el proceso termine). */
export function scheduleMaintenance(db: DB): void {
	const run = () => {
		try {
			runMaintenance(db);
		} catch (e) {
			console.error('[mantenimiento]', e);
		}
	};
	run();
	setInterval(run, HOUR).unref();
}
