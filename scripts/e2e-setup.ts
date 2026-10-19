// Prepara una base limpia para las pruebas E2E: borra data/e2e.db, aplica las
// migraciones y crea el administrador de prueba. La ejecuta playwright.config.ts.
import { rmSync } from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../src/lib/server/db/client';
import { createAdmin } from '../src/lib/server/services/admin-auth';
import { E2E_ADMIN } from '../tests/e2e/fixtures';

const url = process.env.DATABASE_URL;
if (!url?.includes('e2e')) {
	// Protección: nunca borrar la base de desarrollo por error.
	console.error(`DATABASE_URL debe apuntar a una base de pruebas E2E (actual: ${url})`);
	process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) rmSync(url + suffix, { force: true });

const db = createDb(url);
migrate(db, { migrationsFolder: 'drizzle' });
await createAdmin(db, E2E_ADMIN);
db.$client.close();
console.log(`Base E2E lista en ${url}`);
