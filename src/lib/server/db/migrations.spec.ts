import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './client';

// Carpeta de migraciones recortada hasta `upTo` (inclusive), para simular una base anterior.
const dirs: string[] = [];
function migrationsUpTo(upTo: number) {
	const dir = mkdtempSync(join(tmpdir(), 'migraciones-'));
	dirs.push(dir);
	cpSync('drizzle', dir, { recursive: true });
	const journalPath = join(dir, 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
	journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= upTo);
	writeFileSync(journalPath, JSON.stringify(journal));
	return dir;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('migración a clientes', () => {
	it('cada assessment con logo o colores propios pasa a tener un cliente con esa marca', () => {
		const db = createDb(':memory:');
		migrate(db, { migrationsFolder: migrationsUpTo(2) });

		const insert = db.$client.prepare(
			`insert into assessments (id, slug, title, starts_at, ends_at, logo_data, logo_mime, logo_updated_at, theme_primary, theme_accent)
			 values (?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`
		);
		insert.run(
			'a-marca',
			'slugmarca0001',
			'Diagnóstico Acme',
			Buffer.from([1, 2]),
			'image/png',
			5,
			'#1a2b5c',
			'#c2410c'
		);
		insert.run('a-colores', 'slugcolor0001', 'Solo colores', null, null, null, '#112233', null);
		insert.run('a-plano', 'slugplano0001', 'Sin marca', null, null, null, null, null);

		migrate(db, { migrationsFolder: 'drizzle' });

		const clients = db.$client
			.prepare('select id, name, logo_mime, theme_primary, theme_accent from clients order by name')
			.all();
		expect(clients).toEqual([
			{
				id: 'a-marca',
				name: 'Cliente de Diagnóstico Acme',
				logo_mime: 'image/png',
				theme_primary: '#1a2b5c',
				theme_accent: '#c2410c'
			},
			{
				id: 'a-colores',
				name: 'Cliente de Solo colores',
				logo_mime: null,
				theme_primary: '#112233',
				theme_accent: null
			}
		]);
		const links = db.$client.prepare('select id, client_id from assessments order by id').all();
		expect(links).toEqual([
			{ id: 'a-colores', client_id: 'a-colores' },
			{ id: 'a-marca', client_id: 'a-marca' },
			{ id: 'a-plano', client_id: null }
		]);
		// Las columnas de marca del assessment ya no existen.
		const columns = db.$client.prepare('pragma table_info(assessments)').all() as {
			name: string;
		}[];
		expect(columns.map((c) => c.name)).not.toContain('logo_data');
		db.$client.close();
	});
});
