import { describe, expect, it } from 'vitest';
import { productionWarnings } from './startup-checks';

describe('avisos de configuración en producción', () => {
	it('sin ADDRESS_HEADER ni ACCESS_PASSWORD_KEY avisa de ambos', () => {
		const warnings = productionWarnings({});
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain('ADDRESS_HEADER');
		expect(warnings[1]).toContain('ACCESS_PASSWORD_KEY');
	});

	it('con todo configurado no avisa', () => {
		expect(
			productionWarnings({ addressHeader: 'X-Forwarded-For', accessPasswordKey: 'a'.repeat(64) })
		).toEqual([]);
	});
});
