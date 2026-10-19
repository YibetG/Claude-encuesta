import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** La base o una transacción: para funciones que pueden ejecutarse dentro de `db.transaction`. */
export type Executor = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

/**
 * Abre (o crea) la base SQLite. Independiente de SvelteKit para poder usarse
 * también desde los scripts de terminal (migraciones, seed, crear admin) y las pruebas.
 */
export function createDb(url: string): DB {
	if (url !== ':memory:') mkdirSync(dirname(resolve(url)), { recursive: true });

	const client = new Database(url);
	// WAL: lecturas concurrentes mientras se escribe (ej. reportes durante autoguardado).
	client.pragma('journal_mode = WAL');
	// SQLite no aplica las llaves foráneas si no se activan en cada conexión.
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');

	return drizzle(client, { schema });
}
