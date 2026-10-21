import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-db';
import { adminUsers, auditLog } from '../db/schema';
import {
	ClientInUseError,
	clientNameTaken,
	createClient,
	deleteClient,
	detectLogoType,
	getBrand,
	getClient,
	listClients,
	LogoError,
	readClientLogo,
	setClientLogo,
	setClientTheme
} from './clients';
import { createAssessment, duplicateAssessment } from './assessments';
import { participantBrand } from '../logo';
import { assessmentFormSchema } from '../../schemas/assessment';

// PNG mínimo válido (1×1).
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

let db: ReturnType<typeof createTestDb>;
let adminId: string;

const form = (clientId = '') =>
	assessmentFormSchema.parse({
		title: 'Evaluación',
		clientId,
		timezone: 'America/Bogota',
		startsAt: '2026-11-01T08:00',
		endsAt: '2026-11-15T18:00',
		accessMode: 'invitados',
		openMaxChars: '8000'
	});

beforeEach(() => {
	db = createTestDb();
	adminId = db
		.insert(adminUsers)
		.values({ email: 'a@b.co', name: 'Admin', passwordHash: 'x' })
		.returning()
		.get().id;
});

describe('clientes', () => {
	it('detecta el tipo del logo por su contenido y rechaza lo demás', () => {
		expect(detectLogoType(PNG)).toBe('image/png');
		expect(detectLogoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
		expect(() =>
			detectLogoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))
		).toThrow(LogoError);
		expect(() => detectLogoType(Buffer.alloc(0))).toThrow('Seleccione una imagen');
		expect(() => detectLogoType(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]))).toThrow(
			'2 MB'
		);
	});

	it('los assessments heredan el logo y los colores del cliente', () => {
		const c = createClient(db, 'Acme S.A.', adminId);
		setClientLogo(db, c.id, PNG, adminId);
		setClientTheme(db, c.id, { primary: '#1a2b5c', accent: '#c2410c' }, adminId);

		const a = createAssessment(db, form(c.id), adminId);
		const brand = participantBrand(db, a);
		expect(brand.logoUrl).toMatch(new RegExp(`^/a/${a.slug}/logo\\?v=\\d+$`));
		expect(brand.themeStyle).toContain('--color-ink-950: #1a2b5c');
		expect(brand.themeStyle).toContain('--color-brand-600: #c2410c');
		expect(readClientLogo(db, a.clientId)?.data.equals(PNG)).toBe(true);

		// La copia es del mismo cliente; sin cliente se usan los colores de la plataforma.
		expect(duplicateAssessment(db, a.id, adminId)!.clientId).toBe(c.id);
		const libre = createAssessment(db, form(), adminId);
		expect(participantBrand(db, libre)).toEqual({ logoUrl: null, themeStyle: null });

		setClientLogo(db, c.id, null, adminId);
		setClientTheme(db, c.id, null, adminId);
		expect(getBrand(db, c.id)).toMatchObject({ logoMime: null, themePrimary: null });
		expect(participantBrand(db, a)).toEqual({ logoUrl: null, themeStyle: null });
	});

	it('nombres únicos sin distinguir mayúsculas y conteo de assessments', () => {
		const c = createClient(db, 'Acme', adminId);
		expect(clientNameTaken(db, 'ACME')).toBe(true);
		expect(clientNameTaken(db, 'acme', c.id)).toBe(false);
		createAssessment(db, form(c.id), adminId);
		expect(listClients(db)).toMatchObject([{ name: 'Acme', assessmentCount: 1 }]);
	});

	it('solo se elimina un cliente sin assessments, y queda en la auditoría', () => {
		const c = createClient(db, 'Acme', adminId);
		createAssessment(db, form(c.id), adminId);
		expect(() => deleteClient(db, c, adminId)).toThrow(ClientInUseError);

		const vacio = createClient(db, 'Vacío', adminId);
		deleteClient(db, vacio, adminId);
		expect(getClient(db, vacio.id)).toBeUndefined();
		expect(
			db.select().from(auditLog).where(eq(auditLog.action, 'cliente.eliminado')).get()
		).toMatchObject({ entityId: vacio.id, metadata: { nombre: 'Vacío' } });
	});
});
