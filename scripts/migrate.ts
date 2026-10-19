// Aplica las migraciones pendientes de la carpeta `drizzle/`.
// Uso: npm run db:migrate
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../src/lib/server/db/client';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('Falta DATABASE_URL en .env');
	process.exit(1);
}

const db = createDb(url);
migrate(db, { migrationsFolder: 'drizzle' });
db.$client.close();
console.log(`Migraciones aplicadas en ${url}`);
