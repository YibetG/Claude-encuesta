import { eq, inArray, lt, and, isNull, or } from 'drizzle-orm';
import type { DB } from '../db/client';
import { authAttempts } from '../db/schema';

// Rate limiting con bloqueo temporal, guardado en SQLite para que sobreviva a reinicios.
// Cada clave cuenta los intentos fallidos dentro de una ventana de tiempo; al llegar
// al máximo, la clave queda bloqueada durante `lockMs`.

export type RateLimitPolicy = {
	maxFailures: number;
	windowMs: number;
	lockMs: number;
};

// ---- Serialización por clave ----------------------------------------------------
// La verificación de contraseña (Argon2) es asíncrona: sin esto, N peticiones simultáneas
// pasarían todas el chequeo de bloqueo antes de que se registre el primer fallo.
// Las peticiones con la misma IP o el mismo email se atienden de a una (la app corre
// en un solo proceso, así que basta un candado en memoria).
const queues = new Map<string, Promise<void>>();

/** Ejecuta `fn` en exclusión mutua respecto de cualquier otra llamada que comparta alguna clave. */
export async function withKeyLock<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
	// Orden fijo para evitar bloqueos cruzados entre claves.
	const sorted = [...new Set(keys)].sort();
	const previous = sorted.map((k) => queues.get(k) ?? Promise.resolve());
	let release!: () => void;
	const current = new Promise<void>((r) => (release = r));
	for (const k of sorted) queues.set(k, current);
	try {
		await Promise.all(previous);
		return await fn();
	} finally {
		release();
		for (const k of sorted) if (queues.get(k) === current) queues.delete(k);
	}
}

const MIN = 60 * 1000;

/** Por email: pocos intentos, para frenar ataques a una cuenta concreta. */
export const EMAIL_POLICY: RateLimitPolicy = {
	maxFailures: 5,
	windowMs: 15 * MIN,
	lockMs: 15 * MIN
};
/** Por IP: más margen (varias personas pueden compartir IP en una oficina). */
export const IP_POLICY: RateLimitPolicy = { maxFailures: 20, windowMs: 15 * MIN, lockMs: 15 * MIN };

/**
 * Ingreso de participantes por IP: en una empresa muchas personas salen a internet
 * con la misma IP y responden a la vez, así que el margen es mayor.
 */
export const PARTICIPANT_IP_POLICY: RateLimitPolicy = {
	maxFailures: 50,
	windowMs: 15 * MIN,
	lockMs: 15 * MIN
};

export type LimitKey = { key: string; policy: RateLimitPolicy };

/** Construye las claves por IP y por email para un ámbito (ej. "admin-login"). */
export function limitKeys(
	scope: string,
	ip: string,
	email: string,
	ipPolicy: RateLimitPolicy = IP_POLICY
): LimitKey[] {
	return [
		{ key: `${scope}:ip:${ip}`, policy: ipPolicy },
		{ key: `${scope}:email:${email.trim().toLowerCase()}`, policy: EMAIL_POLICY }
	];
}

/** Devuelve hasta cuándo está bloqueada la clave más restringida, o `null` si ninguna lo está. */
export function lockedUntil(db: DB, keys: LimitKey[], now = new Date()): Date | null {
	if (keys.length === 0) return null;
	const rows = db
		.select({ lockedUntil: authAttempts.lockedUntil })
		.from(authAttempts)
		.where(
			inArray(
				authAttempts.key,
				keys.map((k) => k.key)
			)
		)
		.all();

	let latest: Date | null = null;
	for (const { lockedUntil } of rows) {
		if (lockedUntil && lockedUntil > now && (!latest || lockedUntil > latest)) latest = lockedUntil;
	}
	return latest;
}

/** Registra un fallo en cada clave. Devuelve la fecha de bloqueo si alguna quedó bloqueada. */
export function recordFailure(db: DB, keys: LimitKey[], now = new Date()): Date | null {
	return db.transaction((tx) => {
		let locked: Date | null = null;

		for (const { key, policy } of keys) {
			const row = tx.select().from(authAttempts).where(eq(authAttempts.key, key)).get();
			const windowExpired = !row || now.getTime() - row.windowStart.getTime() > policy.windowMs;
			const failures = windowExpired ? 1 : row.failures + 1;

			if (failures >= policy.maxFailures) {
				const until = new Date(now.getTime() + policy.lockMs);
				// Al bloquear se reinicia el contador: tras el bloqueo hay otra tanda de intentos.
				upsert(tx, key, { failures: 0, windowStart: now, lockedUntil: until });
				if (!locked || until > locked) locked = until;
			} else {
				upsert(tx, key, {
					failures,
					windowStart: windowExpired ? now : row.windowStart,
					lockedUntil: row?.lockedUntil ?? null
				});
			}
		}

		return locked;
	});
}

/** Tras un ingreso exitoso se limpia el contador del email (no el de la IP). */
export function clearFailures(db: DB, keys: string[]): void {
	if (keys.length === 0) return;
	db.delete(authAttempts).where(inArray(authAttempts.key, keys)).run();
}

/** Limpieza periódica de registros que ya no bloquean ni cuentan. */
export function purgeStaleAttempts(db: DB, olderThanMs: number, now = new Date()): void {
	const cutoff = new Date(now.getTime() - olderThanMs);
	db.delete(authAttempts)
		.where(
			and(
				lt(authAttempts.windowStart, cutoff),
				or(isNull(authAttempts.lockedUntil), lt(authAttempts.lockedUntil, now))
			)
		)
		.run();
}

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

function upsert(
	tx: Tx,
	key: string,
	values: { failures: number; windowStart: Date; lockedUntil: Date | null }
) {
	tx.insert(authAttempts)
		.values({ key, ...values })
		.onConflictDoUpdate({ target: authAttempts.key, set: values })
		.run();
}

/** Mensaje en español con los minutos restantes de bloqueo. */
export function lockMessage(until: Date, now = new Date()): string {
	const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / MIN));
	return `Demasiados intentos fallidos. Intente de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
}
