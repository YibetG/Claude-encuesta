import { expect, test } from '@playwright/test';

test('la página de inicio está en español y envía encabezados de seguridad', async ({ page }) => {
	const response = await page.goto('/');
	expect(response?.status()).toBe(200);

	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plataforma de Assessments');
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');

	const headers = response!.headers();
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-/);
});

test('una ruta inexistente muestra la página de error en español', async ({ page }) => {
	const response = await page.goto('/no-existe');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Página no encontrada');
});
