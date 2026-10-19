// Crea un administrador (o cambia su contraseña) desde la terminal.
//
// Uso interactivo:
//   npm run create-admin
// Cambiar la contraseña de un admin existente (cierra sus sesiones):
//   npm run create-admin -- --reset --email ana@empresa.com
// Uso no interactivo (CI / pruebas): la contraseña se toma de ADMIN_PASSWORD
//   ADMIN_PASSWORD=... npm run create-admin -- --email ana@empresa.com --name "Ana Pérez"
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createDb } from '../src/lib/server/db/client';
import { adminPasswordSchema, createAdminSchema, emailSchema } from '../src/lib/schemas/admin';
import {
	AdminExistsError,
	createAdmin,
	resetAdminPassword
} from '../src/lib/server/services/admin-auth';

const { values: args } = parseArgs({
	options: {
		email: { type: 'string' },
		name: { type: 'string' },
		reset: { type: 'boolean', default: false }
	}
});

function ask(question: string, hidden = false): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
	if (hidden) {
		// Oculta lo que se escribe (solo se muestra la pregunta).
		const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
		rlAny._writeToOutput = (s: string) => {
			if (s.includes(question)) process.stdout.write(question);
		};
	}
	return new Promise((resolve) =>
		rl.question(question, (answer) => {
			rl.close();
			if (hidden) process.stdout.write('\n');
			resolve(answer);
		})
	);
}

async function askPassword(): Promise<string> {
	if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
	for (;;) {
		const password = await ask('Contraseña (mínimo 10 caracteres): ', true);
		const check = adminPasswordSchema.safeParse(password);
		if (!check.success) {
			console.error(`  ${check.error.issues[0].message}`);
			continue;
		}
		const confirm = await ask('Repita la contraseña: ', true);
		if (confirm !== password) {
			console.error('  Las contraseñas no coinciden.');
			continue;
		}
		return password;
	}
}

function fail(message: string): never {
	console.error(`Error: ${message}`);
	process.exit(1);
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) fail('Falta DATABASE_URL en .env');
	const db = createDb(url);

	try {
		const emailInput = args.email ?? (await ask('Email: '));
		const email = emailSchema.safeParse(emailInput);
		if (!email.success) fail(email.error.issues[0].message);

		if (args.reset) {
			const password = await askPassword();
			const pw = adminPasswordSchema.safeParse(password);
			if (!pw.success) fail(pw.error.issues[0].message);
			const ok = await resetAdminPassword(db, email.data, pw.data);
			if (!ok) fail(`No existe un administrador con el email ${email.data}`);
			console.log(`Contraseña actualizada para ${email.data}. Sus sesiones abiertas se cerraron.`);
			return;
		}

		const name = args.name ?? (await ask('Nombre: '));
		const password = await askPassword();
		const input = createAdminSchema.safeParse({ email: email.data, name, password });
		if (!input.success) fail(input.error.issues[0].message);

		const admin = await createAdmin(db, input.data);
		console.log(`Administrador creado: ${admin.name} <${admin.email}>`);
	} catch (e) {
		if (e instanceof AdminExistsError)
			fail(`${e.message}. Use --reset para cambiar su contraseña.`);
		throw e;
	} finally {
		db.$client.close();
	}
}

await main();
