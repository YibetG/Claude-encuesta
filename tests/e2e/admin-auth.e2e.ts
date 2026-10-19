import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from './fixtures';

async function login(page: Page, email: string, password: string) {
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	// Se espera la respuesta del servidor antes de seguir, para no encadenar envíos.
	await Promise.all([
		page.waitForResponse(
			(r) => r.request().method() === 'POST' && r.url().includes('/admin/login')
		),
		page.getByRole('button', { name: 'Ingresar' }).click()
	]);
}

test('el panel exige iniciar sesión y conserva el destino', async ({ page }) => {
	await page.goto('/admin/auditoria');
	await expect(page).toHaveURL(/\/admin\/login\?destino=%2Fadmin%2Fauditoria$/);
	await expect(page.getByRole('heading', { name: 'Ingreso de administradores' })).toBeVisible();

	await login(page, E2E_ADMIN.email, E2E_ADMIN.password);
	await expect(page).toHaveURL(/\/admin\/auditoria$/);
	await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible();
});

test('credenciales incorrectas muestran un error genérico', async ({ page }) => {
	await page.goto('/admin/login');
	await login(page, E2E_ADMIN.email, 'clave-equivocada');
	await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.');
	// El email se conserva, la contraseña no.
	await expect(page.getByLabel('Email')).toHaveValue(E2E_ADMIN.email);
	await expect(page.getByLabel('Contraseña')).toHaveValue('');
});

test('ingreso, cookie segura, auditoría y cierre de sesión', async ({ page, context }) => {
	await page.goto('/admin/login');
	await login(page, E2E_ADMIN.email, E2E_ADMIN.password);
	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole('banner').getByText(E2E_ADMIN.name, { exact: true })).toBeVisible();

	const cookie = (await context.cookies()).find((c) => c.name === 'admin_session');
	expect(cookie).toBeDefined();
	expect(cookie!.httpOnly).toBe(true);
	expect(cookie!.secure).toBe(true);
	expect(cookie!.sameSite).toBe('Lax');

	await page.getByRole('link', { name: 'Auditoría' }).click();
	await expect(
		page.getByRole('cell', { name: 'Inicio de sesión', exact: true }).first()
	).toBeVisible();

	await page.getByRole('button', { name: 'Cerrar sesión' }).click();
	await expect(page).toHaveURL(/\/admin\/login$/);
	expect((await context.cookies()).find((c) => c.name === 'admin_session')).toBeUndefined();

	await page.goto('/admin');
	await expect(page).toHaveURL(/\/admin\/login/);
});

test('bloqueo temporal tras 5 intentos fallidos', async ({ page }) => {
	await page.goto('/admin/login');
	for (let i = 0; i < 4; i++) {
		await login(page, 'victima@e2e.test', `mala-${i}`);
		await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.');
	}
	await login(page, 'victima@e2e.test', 'mala-final');
	await expect(page.getByRole('alert')).toContainText('Demasiados intentos fallidos');
});

test('el formulario rechaza envíos desde otro origen (CSRF)', async ({ request }) => {
	const res = await request.post('/admin/login', {
		form: { email: E2E_ADMIN.email, password: E2E_ADMIN.password },
		headers: { origin: 'https://sitio-malicioso.com' },
		maxRedirects: 0
	});
	expect(res.status()).toBe(403);
});
