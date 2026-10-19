import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import {
	clearFailures,
	EMAIL_POLICY,
	IP_POLICY,
	limitKeys,
	lockedUntil,
	lockMessage,
	recordFailure
} from './rate-limit';

const MIN = 60 * 1000;
const t0 = new Date('2026-05-01T10:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN);

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
	db = createTestDb();
});

describe('rate limiting', () => {
	it('bloquea el email después de 5 fallos', () => {
		const keys = limitKeys('admin-login', '1.1.1.1', 'Ana@Ejemplo.com');
		for (let i = 1; i < EMAIL_POLICY.maxFailures; i++) {
			expect(recordFailure(db, keys, at(0))).toBeNull();
		}
		const until = recordFailure(db, keys, at(0));
		expect(until).toEqual(at(15));
		expect(lockedUntil(db, keys, at(1))).toEqual(at(15));
	});

	it('el bloqueo por email aplica desde cualquier IP y sin importar mayúsculas', () => {
		const keys = limitKeys('admin-login', '1.1.1.1', 'ana@ejemplo.com');
		for (let i = 0; i < EMAIL_POLICY.maxFailures; i++) recordFailure(db, keys, at(0));
		const otraIp = limitKeys('admin-login', '2.2.2.2', 'ANA@ejemplo.com');
		expect(lockedUntil(db, otraIp, at(1))).not.toBeNull();
	});

	it('bloquea la IP después de 20 fallos con emails distintos', () => {
		for (let i = 0; i < IP_POLICY.maxFailures - 1; i++) {
			recordFailure(db, limitKeys('admin-login', '9.9.9.9', `u${i}@x.com`), at(0));
		}
		const last = limitKeys('admin-login', '9.9.9.9', 'nuevo@x.com');
		expect(lockedUntil(db, last, at(0))).toBeNull();
		expect(recordFailure(db, last, at(0))).not.toBeNull();
		expect(
			lockedUntil(db, limitKeys('admin-login', '9.9.9.9', 'otro@x.com'), at(1))
		).not.toBeNull();
	});

	it('el bloqueo vence después del tiempo configurado', () => {
		const keys = limitKeys('admin-login', '1.1.1.1', 'ana@ejemplo.com');
		for (let i = 0; i < EMAIL_POLICY.maxFailures; i++) recordFailure(db, keys, at(0));
		expect(lockedUntil(db, keys, at(16))).toBeNull();
	});

	it('los fallos fuera de la ventana no se acumulan', () => {
		const keys = limitKeys('admin-login', '1.1.1.1', 'ana@ejemplo.com');
		for (let i = 0; i < EMAIL_POLICY.maxFailures - 1; i++) recordFailure(db, keys, at(0));
		expect(recordFailure(db, keys, at(20))).toBeNull();
	});

	it('limpiar los fallos reinicia el contador', () => {
		const keys = limitKeys('admin-login', '1.1.1.1', 'ana@ejemplo.com');
		for (let i = 0; i < EMAIL_POLICY.maxFailures - 1; i++) recordFailure(db, keys, at(0));
		clearFailures(db, [keys[1].key]);
		expect(recordFailure(db, keys, at(1))).toBeNull();
	});

	it('los ámbitos son independientes', () => {
		const admin = limitKeys('admin-login', '1.1.1.1', 'ana@ejemplo.com');
		for (let i = 0; i < EMAIL_POLICY.maxFailures; i++) recordFailure(db, admin, at(0));
		expect(lockedUntil(db, limitKeys('acceso', '1.1.1.1', 'ana@ejemplo.com'), at(1))).toBeNull();
	});

	it('genera el mensaje en español con los minutos restantes', () => {
		expect(lockMessage(at(15), at(0))).toBe(
			'Demasiados intentos fallidos. Intente de nuevo en 15 minutos.'
		);
		expect(lockMessage(at(0.5), at(0))).toContain('1 minuto.');
	});
});
