import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './fixtures';
import { toLocalDateTimeInput } from '../../src/lib/datetime';

// Logo del cliente por assessment y contraseña de acceso visible para el admin.

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

test('logo del cliente y contraseña visible', async ({ page, browser }) => {
	test.setTimeout(90_000);
	await loginAsAdmin(page);

	await page.goto('/admin/assessments/nuevo');
	await page.getByLabel('Título').fill('Cliente con logo');
	await page
		.getByLabel('Inicio')
		.fill(toLocalDateTimeInput(Date.now() - 3600_000, 'America/Bogota'));
	await page.getByRole('button', { name: 'Crear y agregar preguntas' }).click();
	await expect(page).toHaveURL(/\/preguntas\?creado=1$/);
	const base = page.url().replace(/\/preguntas.*$/, '');
	await page.goto(base);

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

	// ---- Logo: SVG rechazado, PNG aceptado ----
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
	const src = await page.getByAltText('Logo actual').getAttribute('src');
	expect(src).toMatch(/^\/a\/[a-z0-9]{12}\/logo\?v=\d+$/);

	// El logo se sirve como imagen, con tipo detectado y protegido.
	const res = await page.request.get(src!);
	expect(res.headers()['content-type']).toBe('image/png');
	expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
	expect(Buffer.from(await res.body()).equals(PNG)).toBe(true);

	// ---- Colores del cliente: un color claro se rechaza, uno oscuro se guarda ----
	await page.getByLabel('Color principal', { exact: true }).fill('#f5c400');
	await expect(
		page.getByText('Muy claro: el texto blanco no se leería bien.').first()
	).toBeVisible();
	await page.getByRole('button', { name: 'Guardar colores' }).click();
	await expect(page.getByRole('alert')).toContainText('Color principal: es demasiado claro');
	await page.getByLabel('Color principal', { exact: true }).fill('#1a2b5c');
	await page.getByLabel('Color de acento', { exact: true }).fill('#c2410c');
	await page.getByRole('button', { name: 'Guardar colores' }).click();
	await expect(page.getByText('Colores guardados.')).toBeVisible();

	// Publicar (necesita una pregunta) y ver el logo y los colores como participante.
	await page.goto(`${base}/preguntas`);
	await page.getByRole('button', { name: '+ Pregunta abierta' }).click();
	await page.getByLabel('Enunciado de la pregunta 1').fill('¿Comentarios?');
	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByText('Preguntas guardadas.')).toBeVisible();
	await page.goto(base);
	await page.getByRole('button', { name: 'Publicar' }).click();
	await expect(page.getByText('Estado actualizado: Publicado.')).toBeVisible();

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
	await ctx.close();

	// La consulta de la contraseña quedó en la auditoría (sin la contraseña).
	await page.goto('/admin/auditoria');
	await expect(
		page.getByRole('cell', { name: 'Contraseña de acceso consultada', exact: true }).first()
	).toBeVisible();
	await expect(page.getByText(generada)).toHaveCount(0);
});
