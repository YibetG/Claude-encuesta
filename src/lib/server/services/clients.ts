import { asc, eq, sql } from 'drizzle-orm';
import type { DB, Executor } from '../db/client';
import { assessments, clients } from '../db/schema';
import { audit } from '../security/audit';

// Clientes: agrupan assessments y les dan su línea gráfica (logo y colores).
// La marca vive solo en el cliente: todos sus assessments la heredan.

export type Client = typeof clients.$inferSelect;
/** Marca sin la imagen (para pantallas y URLs); el logo en sí se lee aparte. */
export type Brand = Pick<
	Client,
	'id' | 'name' | 'logoMime' | 'logoUpdatedAt' | 'themePrimary' | 'themeAccent'
>;

export class ClientInUseError extends Error {}

export function listClients(db: DB) {
	return db
		.select({
			id: clients.id,
			name: clients.name,
			logoMime: clients.logoMime,
			logoUpdatedAt: clients.logoUpdatedAt,
			themePrimary: clients.themePrimary,
			themeAccent: clients.themeAccent,
			assessmentCount: sql<number>`(select count(*) from "assessments" a where a."client_id" = "clients"."id")`
		})
		.from(clients)
		.orderBy(asc(sql`lower(${clients.name})`))
		.all();
}

/** Opciones para el selector de cliente del formulario de assessment. */
export function clientOptions(db: DB) {
	return db
		.select({ id: clients.id, name: clients.name })
		.from(clients)
		.orderBy(asc(sql`lower(${clients.name})`))
		.all();
}

export function getClient(db: Executor, id: string): Client | undefined {
	return db.select().from(clients).where(eq(clients.id, id)).get();
}

export function clientExists(db: Executor, id: string): boolean {
	return !!db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).get();
}

/** Marca de un cliente (sin la imagen). `null` = colores de la plataforma y sin logo. */
export function getBrand(db: Executor, clientId: string | null): Brand | null {
	if (!clientId) return null;
	return (
		db
			.select({
				id: clients.id,
				name: clients.name,
				logoMime: clients.logoMime,
				logoUpdatedAt: clients.logoUpdatedAt,
				themePrimary: clients.themePrimary,
				themeAccent: clients.themeAccent
			})
			.from(clients)
			.where(eq(clients.id, clientId))
			.get() ?? null
	);
}

/** ¿Ya hay otro cliente con ese nombre? (sin distinguir mayúsculas) */
export function clientNameTaken(db: DB, name: string, exceptId?: string): boolean {
	const row = db
		.select({ id: clients.id })
		.from(clients)
		.where(sql`lower(${clients.name}) = lower(${name})`)
		.get();
	return !!row && row.id !== exceptId;
}

export function createClient(db: DB, name: string, adminId: string, ip?: string): Client {
	const created = db.insert(clients).values({ name, createdById: adminId }).returning().get();
	audit(db, {
		adminId,
		action: 'cliente.creado',
		entityType: 'cliente',
		entityId: created.id,
		metadata: { nombre: name },
		ip
	});
	return created;
}

function touch(
	db: DB,
	id: string,
	set: Partial<Client>,
	adminId: string,
	cambio: object,
	ip?: string
) {
	db.update(clients)
		.set({ ...set, updatedAt: new Date() })
		.where(eq(clients.id, id))
		.run();
	audit(db, {
		adminId,
		action: 'cliente.editado',
		entityType: 'cliente',
		entityId: id,
		metadata: { ...cambio },
		ip
	});
}

export function renameClient(db: DB, id: string, name: string, adminId: string, ip?: string) {
	touch(db, id, { name }, adminId, { nombre: name }, ip);
}

/** Guarda los colores (ya validados con themeSchema) o vuelve a los de la plataforma. */
export function setClientTheme(
	db: DB,
	id: string,
	theme: { primary: string; accent: string } | null,
	adminId: string,
	ip?: string
) {
	touch(
		db,
		id,
		{ themePrimary: theme?.primary ?? null, themeAccent: theme?.accent ?? null },
		adminId,
		theme
			? { cambio: 'colores', principal: theme.primary, acento: theme.accent }
			: { cambio: 'colores de la plataforma' },
		ip
	);
}

export function setClientLogo(
	db: DB,
	id: string,
	data: Buffer | null,
	adminId: string,
	ip?: string
) {
	const mime = data ? detectLogoType(data) : null;
	touch(
		db,
		id,
		{ logoData: data, logoMime: mime, logoUpdatedAt: data ? new Date() : null },
		adminId,
		{ cambio: data ? 'logo actualizado' : 'logo eliminado' },
		ip
	);
}

/** Solo se elimina un cliente sin assessments (para no dejar assessments sin marca por error). */
export function deleteClient(db: DB, client: Client, adminId: string, ip?: string) {
	db.transaction((tx) => {
		const inUse = tx
			.select({ id: assessments.id })
			.from(assessments)
			.where(eq(assessments.clientId, client.id))
			.limit(1)
			.get();
		if (inUse) {
			throw new ClientInUseError(
				'El cliente tiene assessments. Elimínelos o asígnelos a otro cliente primero.'
			);
		}
		tx.delete(clients).where(eq(clients.id, client.id)).run();
		audit(tx, {
			adminId,
			action: 'cliente.eliminado',
			entityType: 'cliente',
			entityId: client.id,
			metadata: { nombre: client.name },
			ip
		});
	});
}

// ---- Logo ---------------------------------------------------------------------

export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // logos en alta resolución
const LOGO_TYPES = {
	'image/png': (b: Buffer) =>
		b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
	'image/jpeg': (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	'image/webp': (b: Buffer) =>
		b.subarray(0, 4).toString('latin1') === 'RIFF' &&
		b.subarray(8, 12).toString('latin1') === 'WEBP'
} as const;
export type LogoMime = keyof typeof LOGO_TYPES;

export class LogoError extends Error {}

/**
 * Valida el logo por su contenido (no por la extensión ni el tipo que declara el navegador).
 * SVG no se acepta: puede contener scripts.
 */
export function detectLogoType(data: Buffer): LogoMime {
	if (data.length === 0) throw new LogoError('Seleccione una imagen.');
	if (data.length > LOGO_MAX_BYTES) throw new LogoError('El logo no puede superar 2 MB.');
	for (const [mime, check] of Object.entries(LOGO_TYPES) as [LogoMime, (b: Buffer) => boolean][]) {
		if (check(data)) return mime;
	}
	throw new LogoError('Formato no soportado. Use una imagen PNG, JPG o WebP.');
}

/** Imagen del logo de un cliente, o `undefined` si no tiene. */
export function readClientLogo(db: Executor, clientId: string | null) {
	if (!clientId) return undefined;
	const row = db
		.select({ data: clients.logoData, mime: clients.logoMime })
		.from(clients)
		.where(eq(clients.id, clientId))
		.get();
	return row?.data && row.mime ? { data: row.data, mime: row.mime } : undefined;
}
