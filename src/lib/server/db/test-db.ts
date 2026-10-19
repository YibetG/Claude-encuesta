import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './client';

/** Base en memoria con todas las migraciones aplicadas, para pruebas unitarias. */
export function createTestDb() {
	const db = createDb(':memory:');
	migrate(db, { migrationsFolder: 'drizzle' });
	return db;
}
