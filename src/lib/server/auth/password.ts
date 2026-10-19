import { hash, verify, type Algorithm } from '@node-rs/argon2';

// Argon2id con los parámetros mínimos recomendados por OWASP
// (19 MiB de memoria, 2 iteraciones, 1 hilo).
const OPTIONS = {
	// `Algorithm.Argon2id` es un const enum (no importable con verbatimModuleSyntax); su valor es 2.
	algorithm: 2 as Algorithm,
	memoryCost: 19_456,
	timeCost: 2,
	parallelism: 1
} as const;

export function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
}

/** Devuelve `false` (sin lanzar error) si el hash está vacío o mal formado. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		return await verify(passwordHash, password);
	} catch {
		return false;
	}
}

// Hash de una contraseña aleatoria. Se verifica contra él cuando el email no existe,
// para que la respuesta tarde lo mismo y no revele qué emails están registrados.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
	dummyHash ??= hashPassword(crypto.randomUUID());
	return dummyHash;
}
