import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Cifrado reversible (AES-256-GCM) para la contraseña de acceso de cada assessment,
// de modo que el administrador pueda volver a verla. La clave de cifrado:
// - se toma de ACCESS_PASSWORD_KEY (64 caracteres hex = 32 bytes) si está definida;
// - si no, se crea una vez en un archivo junto a la base (clave-cifrado.key).
// Sin la clave no se puede descifrar: inclúyala en los respaldos (o defínala en .env).

const KEY_FILE = 'clave-cifrado.key';
let key: Buffer | null = null;
let warned = false;

/** Configura la clave a partir de la variable de entorno o del archivo junto a la base. */
export function configureSecretKey(opts: { envKey?: string; dbUrl: string }): void {
	if (opts.envKey) {
		if (!/^[0-9a-f]{64}$/i.test(opts.envKey)) {
			throw new Error('ACCESS_PASSWORD_KEY debe tener 64 caracteres hexadecimales (32 bytes).');
		}
		key = Buffer.from(opts.envKey, 'hex');
		return;
	}
	if (opts.dbUrl === ':memory:') {
		key = randomBytes(32);
		return;
	}
	const file = join(dirname(resolve(opts.dbUrl)), KEY_FILE);
	if (existsSync(file)) {
		key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
	} else {
		mkdirSync(dirname(file), { recursive: true });
		key = randomBytes(32);
		writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
		console.info(`[cifrado] Se creó la clave de cifrado en ${file}. Inclúyala en los respaldos.`);
	}
	if (key.length !== 32) throw new Error(`La clave de ${file} no es válida.`);
}

function currentKey(): Buffer {
	if (!key) {
		// Sin configurar (por ejemplo en pruebas unitarias): clave temporal del proceso.
		if (!warned && !process.env.VITEST) {
			console.warn('[cifrado] Clave no configurada: se usa una temporal (no recuperable).');
			warned = true;
		}
		key = randomBytes(32);
	}
	return key;
}

export function encryptSecret(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', currentKey(), iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Devuelve el texto o `null` si el dato está dañado o se cifró con otra clave. */
export function decryptSecret(payload: string): string | null {
	const [v, iv, tag, ct] = payload.split(':');
	if (v !== 'v1' || !iv || !tag || !ct) return null;
	try {
		const decipher = createDecipheriv('aes-256-gcm', currentKey(), Buffer.from(iv, 'base64'));
		decipher.setAuthTag(Buffer.from(tag, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString(
			'utf8'
		);
	} catch {
		return null;
	}
}
