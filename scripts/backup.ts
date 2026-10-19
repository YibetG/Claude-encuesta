// Respaldo en caliente de la base SQLite (seguro aunque la app esté en uso).
// Usa la API de backup de SQLite, que copia una foto consistente incluyendo el WAL.
//
// Uso:
//   npm run db:backup                         → backups/app-AAAAMMDD-HHMMSS.db
//   npm run db:backup -- --dir D:\respaldos   → otra carpeta
//   npm run db:backup -- --keep 14            → conserva solo los 14 más recientes
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

const { values: args } = parseArgs({
	options: { dir: { type: 'string', default: 'backups' }, keep: { type: 'string' } }
});

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('Falta DATABASE_URL en .env');
	process.exit(1);
}

const dir = resolve(args.dir!);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dest = join(dir, `app-${stamp}.db`);

const db = new Database(url, { readonly: true, fileMustExist: true });
try {
	await db.backup(dest);
} finally {
	db.close();
}
console.log(`Respaldo creado: ${dest} (${(statSync(dest).size / 1024).toFixed(0)} KB)`);

const keep = args.keep ? Number(args.keep) : undefined;
if (keep && Number.isInteger(keep) && keep > 0) {
	const old = readdirSync(dir)
		.filter((f) => /^app-\d{8}-\d{6}\.db$/.test(f))
		.sort()
		.reverse()
		.slice(keep);
	for (const f of old) rmSync(join(dir, f));
	if (old.length) console.log(`Se eliminaron ${old.length} respaldos antiguos.`);
}
