import { createHash, randomBytes } from 'node:crypto';

/** Token aleatorio de 256 bits para cookies de sesión. */
export function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * Lo que se guarda en la base es el SHA-256 del token, no el token:
 * quien lea la base no puede usar las sesiones activas.
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
