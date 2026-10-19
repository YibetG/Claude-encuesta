import { describe, expect, it } from 'vitest';
import { applySecurityHeaders } from './headers';

describe('applySecurityHeaders', () => {
	it('agrega los encabezados básicos', () => {
		const h = new Headers();
		applySecurityHeaders(h, new URL('http://localhost/'));
		expect(h.get('X-Frame-Options')).toBe('DENY');
		expect(h.get('X-Content-Type-Options')).toBe('nosniff');
		expect(h.get('Referrer-Policy')).toBe('same-origin');
		expect(h.get('Strict-Transport-Security')).toBeNull();
	});

	it('agrega HSTS solo sobre HTTPS', () => {
		const h = new Headers();
		applySecurityHeaders(h, new URL('https://ejemplo.com/'));
		expect(h.get('Strict-Transport-Security')).toContain('max-age=');
	});

	it('no sobrescribe un encabezado definido por la ruta', () => {
		const h = new Headers({ 'Referrer-Policy': 'no-referrer' });
		applySecurityHeaders(h, new URL('http://localhost/'));
		expect(h.get('Referrer-Policy')).toBe('no-referrer');
	});
});
