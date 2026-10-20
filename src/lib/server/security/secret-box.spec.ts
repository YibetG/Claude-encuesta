import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { configureSecretKey, decryptSecret, encryptSecret } from './secret-box';

const dir = mkdtempSync(join(tmpdir(), 'clave-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('cifrado de la contraseña de acceso', () => {
	it('cifra y descifra; cada cifrado es distinto (IV aleatorio)', () => {
		configureSecretKey({ dbUrl: ':memory:' });
		const a = encryptSecret('acceso-2026');
		const b = encryptSecret('acceso-2026');
		expect(a).not.toBe(b);
		expect(a).not.toContain('acceso-2026');
		expect(decryptSecret(a)).toBe('acceso-2026');
	});

	it('devuelve null si el dato fue alterado o se cifró con otra clave', () => {
		configureSecretKey({ dbUrl: ':memory:' });
		const c = encryptSecret('secreto');
		const [v, iv, tag, ct] = c.split(':');
		const tampered = [v, iv, tag, Buffer.from('x' + ct).toString('base64')].join(':');
		expect(decryptSecret(tampered)).toBeNull();
		configureSecretKey({ dbUrl: ':memory:' }); // otra clave
		expect(decryptSecret(c)).toBeNull();
		expect(decryptSecret('basura')).toBeNull();
	});

	it('crea la clave en un archivo junto a la base y la reutiliza', () => {
		const dbUrl = join(dir, 'app.db');
		configureSecretKey({ dbUrl });
		const c = encryptSecret('persistente');
		const keyFile = join(dir, 'clave-cifrado.key');
		expect(readFileSync(keyFile, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
		expect(statSync(keyFile).size).toBeGreaterThan(0);
		configureSecretKey({ dbUrl }); // "reinicio": lee el mismo archivo
		expect(decryptSecret(c)).toBe('persistente');
	});

	it('acepta la clave desde la variable de entorno y valida su formato', () => {
		const envKey = 'a'.repeat(64);
		configureSecretKey({ envKey, dbUrl: ':memory:' });
		const c = encryptSecret('x');
		configureSecretKey({ envKey, dbUrl: ':memory:' });
		expect(decryptSecret(c)).toBe('x');
		expect(() => configureSecretKey({ envKey: 'corta', dbUrl: ':memory:' })).toThrow(
			'ACCESS_PASSWORD_KEY'
		);
	});
});
