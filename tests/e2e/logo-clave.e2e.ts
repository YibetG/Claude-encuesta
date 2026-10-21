import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './fixtures';
import { toLocalDateTimeInput } from '../../src/lib/datetime';

// Clientes (logo y colores que heredan sus assessments) y contraseña de acceso visible.

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

test('cliente con logo y colores, y contraseña visible', async ({ page, browser }) => {
	test.setTimeout(90_000);
	await loginAsAdmin(page);

	// ---- Cliente: nombre único, logo y colores ----
	await page.getByRole('link', { name: 'Clientes' }).click();
	await page.getByLabel('Nuevo cliente').fill('Acme S.A.');
	await page.getByRole('button', { name: 'Crear cliente' }).click();
	await expect(page.getByText('Cliente creado.')).toBeVisible();
	const clientUrl = page.url().replace(/\?.*$/, '');

	await page.goto('/admin/clientes');
	await page.getByLabel('Nuevo cliente').fill('acme s.a.');
	await page.getByRole('button', { name: 'Crear cliente' }).click();
	await expect(page.getByRole('alert')).toHaveText('Ya existe un cliente con ese nombre.');
	await page.goto(clientUrl);

	// Logo: SVG rechazado, PNG aceptado.
	await page.getByLabel('Imagen (PNG, JPG o WebP · máx. 2 MB)').setInputFiles({
		name: 'logo.svg',
		mimeType: 'image/svg+xml',
		buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
	});
	await page.getByRole('button', { name: 'Subir logo' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'Formato no soportado. Use una imagen PNG, JPG o WebP.'
	);
	await page.getByLabel('Imagen (PNG, JPG o WebP · máx. 2 MB)').setInputFiles({
		name: 'logo.png',
		mimeType: 'image/png',
		buffer: PNG
	});
	await page.getByRole('button', { name: 'Subir logo' }).click();
	await expect(page.getByText('Logo actualizado.')).toBeVisible();
	const adminSrc = await page.getByAltText('Logo actual').getAttribute('src');
	expect(adminSrc).toMatch(/^\/admin\/clientes\/[0-9a-f-]{36}\/logo\?v=\d+$/);

	// Colores: un tono claro advierte pero se puede guardar; uno mal escrito no.
	await page.getByLabel('Color principal', { exact: true }).fill('#f5c400');
	await expect(
		page.getByText(/Tono claro: el texto blanco encima podría no leerse bien/)
	).toBeVisible();
	await page.getByRole('button', { name: 'Guardar colores' }).click();
	await expect(page.getByText('Colores guardados. Quedó un tono claro')).toBeVisible();
	await page.getByLabel('Color principal', { exact: true }).fill('amarillo');
	await page.getByRole('button', { name: 'Guardar colores' }).click();
	await expect(page.getByRole('alert')).toContainText('Color principal: use un color en formato');
	await page.getByLabel('Color principal', { exact: true }).fill('#1a2b5c');
	await page.getByLabel('Color de acento', { exact: true }).fill('#c2410c');
	await page.getByRole('button', { name: 'Guardar colores' }).click();
	await expect(page.getByText('Colores guardados.')).toBeVisible();

	// ---- Assessment del cliente (el cliente viene preseleccionado) ----
	await page.getByRole('link', { name: 'Nuevo assessment para Acme S.A.' }).click();
	await expect(page.getByLabel('Cliente', { exact: true })).toHaveValue(
		clientUrl.split('/').pop()!
	);
	await page.getByLabel('Título').fill('Diagnóstico Acme');
	await page
		.getByLabel('Inicio')
		.fill(toLocalDateTimeInput(Date.now() - 3600_000, 'America/Bogota'));
	await page.getByRole('button', { name: 'Crear y agregar preguntas' }).click();
	await expect(page).toHaveURL(/\/preguntas\?creado=1$/, { timeout: 15_000 });
	const base = page.url().replace(/\/preguntas.*$/, '');

	await page.getByRole('button', { name: '+ Pregunta abierta' }).click();
	await page.getByLabel('Enunciado de la pregunta 1').fill('¿Comentarios?');
	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByText('Preguntas guardadas.')).toBeVisible();
	await page.goto(base);
	await expect(
		page.getByRole('region', { name: 'Cliente y línea gráfica' }).getByText('Acme S.A.')
	).toBeVisible();
	await expect(page.getByRole('link', { name: 'Editar logo y colores del cliente' })).toBeVisible();

	// ---- Contraseña: se puede ver lo escrito, guardar y luego mostrarla ----
	await page.getByRole('button', { name: 'Generar una contraseña segura' }).click();
	const generada = await page.getByLabel('Contraseña', { exact: true }).inputValue();
	expect(generada).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
	await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('type', 'text');
	await page.getByRole('button', { name: 'Guardar', exact: true }).click();
	await expect(page.getByText('Contraseña de acceso actualizada.')).toBeVisible();
	await page.getByRole('button', { name: 'Mostrar' }).click();
	await expect(page.getByLabel('Contraseña vigente')).toHaveText(generada);
	await page.getByRole('button', { name: 'Ocultar', exact: true }).click();
	await expect(page.getByLabel('Contraseña vigente')).toHaveCount(0);

	await page.getByRole('button', { name: 'Publicar' }).click();
	await expect(page.getByText('Estado actualizado: Publicado.')).toBeVisible();

	// ---- El participante ve el logo y los colores del cliente ----
	const src = await page.getByAltText('Logo del cliente').first().getAttribute('src');
	expect(src).toMatch(/^\/a\/[a-z0-9]{12}\/logo\?v=\d+$/);
	const res = await page.request.get(src!);
	expect(res.headers()['content-type']).toBe('image/png');
	expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
	expect(Buffer.from(await res.body()).equals(PNG)).toBe(true);

	const slug = src!.split('/')[2];
	const ctx = await browser.newContext();
	const p = await ctx.newPage();
	await p.goto(`/a/${slug}`);
	await expect(p.getByAltText('Logo')).toHaveAttribute('src', src!);
	await expect(p.locator('header').first()).toHaveCSS('background-color', 'rgb(26, 43, 92)');
	await expect(p.getByRole('button', { name: 'Ingresar' })).toHaveCSS(
		'background-color',
		'rgb(194, 65, 12)'
	);
	// El logo de administración no es público.
	const anon = await p.request.get(adminSrc!, { maxRedirects: 0 });
	expect(anon.status()).toBe(303);
	await ctx.close();

	// ---- Un cliente con assessments no se puede eliminar ----
	await page.goto(clientUrl);
	await expect(page.getByText('Diagnóstico Acme')).toBeVisible();
	await expect(page.getByText('Solo se puede eliminar un cliente sin assessments.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Eliminar cliente' })).toHaveCount(0);

	// La consulta de la contraseña quedó en la auditoría (sin la contraseña).
	await page.goto('/admin/auditoria');
	await expect(
		page.getByRole('cell', { name: 'Contraseña de acceso consultada', exact: true }).first()
	).toBeVisible();
	await expect(page.getByText(generada)).toHaveCount(0);
});
