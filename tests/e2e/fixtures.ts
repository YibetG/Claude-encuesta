import { expect, type Page } from '@playwright/test';

// Credenciales de prueba para la base E2E (data/e2e.db). No son credenciales reales.
export const E2E_ADMIN = {
	email: 'admin@e2e.test',
	name: 'Admin E2E',
	password: 'clave-e2e-1234'
};

export const E2E_DB = 'data/e2e.db';

/** Llena el formulario de login y espera la respuesta del servidor. */
export async function submitLogin(page: Page, email: string, password: string) {
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await Promise.all([
		page.waitForResponse(
			(r) => r.request().method() === 'POST' && r.url().includes('/admin/login')
		),
		page.getByRole('button', { name: 'Ingresar' }).click()
	]);
}

export async function loginAsAdmin(page: Page) {
	await page.goto('/admin/login');
	await submitLogin(page, E2E_ADMIN.email, E2E_ADMIN.password);
	await expect(page).toHaveURL(/\/admin$/);
}
