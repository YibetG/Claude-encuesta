import { defineConfig } from '@playwright/test';

// Las pruebas E2E usan una base aparte (data/e2e.db) para no tocar la de desarrollo.
const env = { DATABASE_URL: 'data/e2e.db', APP_URL: 'http://localhost:4173' };

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.{ts,js}',
	use: { baseURL: 'http://localhost:4173', locale: 'es-CO', timezoneId: 'America/Bogota' },
	webServer: {
		command: 'npm run build && npm run db:migrate && npm run preview',
		port: 4173,
		env,
		timeout: 180_000,
		reuseExistingServer: !process.env.CI
	}
});
