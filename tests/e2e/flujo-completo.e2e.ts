import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './fixtures';
import { toLocalDateTimeInput } from '../../src/lib/datetime';

// Flujo de punta a punta, todo por la interfaz:
// crear → preguntas → contraseña → publicar → invitar → ingresar → responder → entregar → reportar → exportar.

const ACCESS_PASSWORD = 'flujo-completo-2026';

test('flujo completo: invitar, responder, reportar y exportar', async ({ page, browser }) => {
	test.setTimeout(120_000);

	// ---- Admin: crea el assessment ----
	await loginAsAdmin(page);
	await page.goto('/admin/assessments/nuevo');
	await page.getByLabel('Título').fill('Flujo completo E2E');
	await page.getByLabel('Instrucciones').fill('Responda con sinceridad.');
	// Por defecto el formulario propone empezar mañana: aquí debe estar disponible ya.
	await page
		.getByLabel('Inicio')
		.fill(toLocalDateTimeInput(Date.now() - 3600_000, 'America/Bogota'));
	await page.getByRole('button', { name: 'Crear y agregar preguntas' }).click();
	await expect(page).toHaveURL(/\/preguntas\?creado=1$/);
	const base = page.url().replace(/\/preguntas.*$/, '');

	// Preguntas: una de selección y una abierta.
	await page.getByRole('button', { name: '+ Pregunta de selección' }).click();
	await page
		.getByLabel('Enunciado de la pregunta 1')
		.fill('¿Cuál es el canal para reportar incidentes?');
	await page.getByLabel('Texto de la opción 1').fill('La mesa de ayuda de seguridad');
	await page.getByLabel('Texto de la opción 2').fill('Un grupo de chat personal');
	await page.getByRole('button', { name: '+ Pregunta abierta' }).click();
	await page.getByLabel('Enunciado de la pregunta 2').fill('¿Qué mejoraría del proceso?');
	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByText('Preguntas guardadas.')).toBeVisible();

	// Contraseña de acceso y publicación.
	await page.goto(base);
	await page.getByLabel('Contraseña', { exact: true }).fill(ACCESS_PASSWORD);
	await page.getByLabel('Repetir contraseña').fill(ACCESS_PASSWORD);
	await page.getByRole('button', { name: 'Guardar', exact: true }).click();
	await expect(page.getByText('Contraseña de acceso actualizada.')).toBeVisible();
	await page.getByRole('button', { name: 'Publicar' }).click();
	await expect(page.getByText('Estado actualizado: Publicado.')).toBeVisible();

	// ---- Invitar ----
	await page.goto(`${base}/participantes`);
	await page.getByText('Agregar participante').click();
	await page.getByLabel('Nombre').fill('Paula Flujo');
	await page.getByLabel('Email').fill('paula@flujo.test');
	await page.getByLabel('Área').fill('Operaciones');
	await page.getByRole('button', { name: 'Agregar', exact: true }).click();
	await expect(page.getByText('Participante agregado: paula@flujo.test.')).toBeVisible();

	await page.goto(`${base}/invitaciones`);
	page.on('dialog', (d) => d.accept());
	// La contraseña está guardada (cifrada): no hay que escribirla para invitar.
	await page.getByRole('button', { name: 'Enviar invitaciones' }).click();
	await expect(page.getByText('Se enviaron 1 de 1 invitaciones.')).toBeVisible();

	// El mensaje de invitación trae el enlace y la contraseña: es lo que recibe la persona.
	await page.getByRole('button', { name: 'Generar mensaje' }).click();
	const mensaje = await page.locator('#generic').inputValue();
	const enlace = mensaje.match(/https?:\/\/\S+\/a\/[a-z0-9]{12}/)![0];
	expect(mensaje).toContain(`Contraseña de acceso: ${ACCESS_PASSWORD}`);

	// ---- Participante (otro navegador): ingresa, responde y entrega ----
	const ctx = await browser.newContext();
	const p = await ctx.newPage();
	p.on('dialog', (d) => d.accept());
	await p.goto(new URL(enlace).pathname);
	await p.getByLabel('Contraseña de acceso').fill(ACCESS_PASSWORD);
	await p.getByLabel('Su correo electrónico').fill('paula@flujo.test');
	await p.getByRole('button', { name: 'Ingresar' }).click();
	await expect(p).toHaveURL(/\/responder$/);
	await expect(p.getByText('Responda con sinceridad.')).toBeVisible();

	await p.getByLabel('La mesa de ayuda de seguridad').check();
	await p
		.getByLabel('2. ¿Qué mejoraría del proceso?')
		.fill('Un formulario más corto para reportar.');
	await expect(p.getByRole('status')).toContainText('Guardado', { timeout: 10_000 });
	await p.getByRole('button', { name: 'Entregar respuestas' }).click();
	await expect(p).toHaveURL(/\/entregado$/);
	await ctx.close();

	// ---- Admin: reporte ----
	await page.goto(`${base}/reportes`);
	const tile = (label: string) => page.locator('dt', { hasText: label }).locator('xpath=../dd');
	await expect(tile('Entregas')).toHaveText('1');
	await expect(tile('Tasa de participación')).toHaveText('100%');
	const q1 = page.locator('#pregunta-1');
	await expect(q1).toContainText('1 eligió la opción esperada');
	await expect(q1).toContainText('Alineación 100%');
	await page.locator('#pregunta-2').getByText('Ver 1 respuesta').click();
	await expect(page.getByText('Un formulario más corto para reportar.')).toBeVisible();

	// Filtro por área.
	await page.getByLabel('Área').selectOption('Operaciones');
	await page.getByRole('button', { name: 'Aplicar' }).click();
	await expect(page).toHaveURL(/area=Operaciones/);
	await expect(tile('Participantes')).toHaveText('1');

	// ---- Exportar ----
	const [excel] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('link', { name: 'Descargar Excel' }).click()
	]);
	expect(excel.suggestedFilename()).toMatch(/^informe-flujo-completo-e2e-.*\.xlsx$/);
	const [pdf] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('link', { name: 'Descargar PDF' }).click()
	]);
	expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);

	// Todo quedó en la auditoría.
	await page.goto('/admin/auditoria');
	for (const accion of [
		'Assessment creado',
		'Preguntas editadas',
		'Contraseña de acceso cambiada',
		'Participantes cargados',
		'Invitaciones enviadas',
		'Reporte exportado'
	]) {
		await expect(page.getByRole('cell', { name: accion, exact: true }).first()).toBeVisible();
	}
});
