import { describe, expect, it } from 'vitest';
import { enterSchema } from './access';
import { accessPasswordSchema } from './assessment';

describe('contraseña de acceso', () => {
	const parse = (password: string) => accessPasswordSchema.safeParse({ password, confirm: password });

	it('exige al menos 12 caracteres', () => {
		const r = parse('acceso-2026');
		expect(r.success).toBe(false);
		expect(r.error?.issues[0].message).toBe(
			'La contraseña de acceso debe tener al menos 12 caracteres.'
		);
	});

	it('acepta 12 caracteres o más', () => {
		expect(parse('acceso-20261').success).toBe(true);
	});
});

describe('ingreso del participante: nombre', () => {
	const parse = (name: string) =>
		enterSchema.safeParse({ password: 'x', email: 'ana@x.co', name });

	it('acepta un nombre normal', () => {
		expect(parse('Ana María Pérez-Gómez').success).toBe(true);
	});

	it.each(['http://malo.example', 'Ana https://malo.example', 'visite www.malo.example'])(
		'rechaza enlaces: %s',
		(name) => {
			const r = parse(name);
			expect(r.success).toBe(false);
			expect(r.error?.issues[0].message).toBe('El nombre no puede contener enlaces.');
		}
	);

	it('rechaza saltos de línea', () => {
		const r = parse('Ana\nPérez');
		expect(r.success).toBe(false);
		expect(r.error?.issues[0].message).toBe('El nombre no puede tener saltos de línea.');
	});
});
