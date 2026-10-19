import { defineConfig } from '@playwright/test';

// Las pruebas E2E usan una base aparte (data/e2e.db) que se recrea en cada corrida.
const env = { DATABASE_URL: 'data/e2e.db', APP_URL: 'http://localhost:4173' };

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.{ts,js}',
	// Las pruebas comparten la base y los contadores de intentos: se ejecutan en orden.
	workers: 1,
	use: { baseURL: 'http://localhost:4173', locale: 'es-CO', timezoneId: 'America/Bogota' },
	webServer: {
		command: 'npm run build && npx tsx scripts/e2e-setup.ts && npm run preview',
		port: 4173,
		env,
		timeout: 180_000,
		// Siempre un servidor nuevo, para que la base E2E esté limpia.
		reuseExistingServer: false
	}
});
