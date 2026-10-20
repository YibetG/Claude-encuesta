import { expect, test, type Page } from '@playwright/test';
import { createDb } from '../../src/lib/server/db/client';
import { participants, submissions } from '../../src/lib/server/db/schema';
import { E2E_DB, loginAsAdmin } from './fixtures';

test.describe.configure({ mode: 'serial' });

let assessmentUrl = '';

async function crearAssessment(page: Page, titulo: string) {
	await page.goto('/admin');
	await page.getByRole('link', { name: 'Nuevo assessment' }).click();
	await page.getByLabel('Título').fill(titulo);
	await page.getByLabel('Descripción').fill('Evaluación de conceptos de seguridad.');
	await page.getByRole('button', { name: 'Crear y agregar preguntas' }).click();
	// Margen extra: la primera creación de la corrida a veces tarda más (carga en frío).
	await expect(page).toHaveURL(/\/admin\/assessments\/[0-9a-f-]{36}\/preguntas\?creado=1$/, {
		timeout: 15_000
	});
	await expect(page.getByText('Assessment creado.')).toBeVisible();
	return page.url().replace(/\/preguntas.*$/, '');
}

test.beforeEach(async ({ page }) => {
	await loginAsAdmin(page);
});

test('crear assessment y editar preguntas', async ({ page }) => {
	assessmentUrl = await crearAssessment(page, 'Seguridad de la información');

	// Guardar con el enunciado vacío muestra el error por pregunta.
	await page.getByRole('button', { name: '+ Pregunta de selección' }).click();
	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByRole('alert')).toContainText('Pregunta 1: Escriba el enunciado.');

	await page.getByLabel('Enunciado de la pregunta 1').fill('¿Qué protege la confidencialidad?');
	await page.getByLabel('Texto de la opción 1').fill('La disponibilidad');
	await page.getByLabel('Texto de la opción 2').fill('El acceso solo a autorizados');
	await page.getByRole('button', { name: '+ Agregar opción' }).click();
	await page.getByLabel('Texto de la opción 3').fill('El rendimiento');
	await page.getByLabel('Marcar opción 2 como correcta').check();

	await page.getByRole('button', { name: '+ Pregunta abierta' }).click();
	await page
		.getByLabel('Enunciado de la pregunta 2')
		.fill('Describa un incidente que haya vivido.');
	await page.getByLabel('Obligatoria').nth(1).uncheck();

	// Reordenar: la abierta pasa a ser la primera.
	await page.getByRole('button', { name: 'Subir pregunta 2' }).click();
	await expect(page.getByLabel('Enunciado de la pregunta 1')).toHaveValue(
		'Describa un incidente que haya vivido.'
	);

	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByText('Preguntas guardadas.')).toBeVisible();
	await expect(page.getByText('2 preguntas: 1 de selección (50%) · 1 abiertas')).toBeVisible();

	// Al recargar, todo persiste (incluida la opción correcta).
	await page.reload();
	await expect(page.getByLabel('Enunciado de la pregunta 2')).toHaveValue(
		'¿Qué protege la confidencialidad?'
	);
	await expect(page.getByLabel('Marcar opción 2 como correcta')).toBeChecked();
	await expect(page.getByLabel('Obligatoria').first()).not.toBeChecked();
	await expect(page.getByRole('link', { name: 'Preguntas (2)' })).toBeVisible();
});

test('importar preguntas desde la plantilla de Excel', async ({ page }) => {
	await page.goto(`${assessmentUrl}/preguntas`);
	const plantilla = await page.request.get(`${assessmentUrl}/preguntas/plantilla`);
	expect(plantilla.headers()['content-type']).toContain('spreadsheetml');

	await page.getByText('Importar preguntas desde Excel o CSV').click();
	await page.getByLabel('Archivo (.xlsx o .csv, máx. 2 MB)').setInputFiles({
		name: 'preguntas.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: await plantilla.body()
	});
	await page.getByRole('button', { name: 'Importar' }).click();
	await expect(page.getByText('Se importaron 2 preguntas.')).toBeVisible();
	await expect(page.getByLabel('Enunciado de la pregunta 4')).toBeVisible();

	// Un CSV con errores no importa nada.
	await page.getByLabel('Archivo (.xlsx o .csv, máx. 2 MB)').setInputFiles({
		name: 'malo.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('tipo;enunciado\nencuesta;Hola\n')
	});
	await page.getByRole('button', { name: 'Importar' }).click();
	await expect(page.getByRole('alert')).toContainText('Fila 2: tipo "encuesta" no reconocido');
	await expect(page.getByRole('link', { name: 'Preguntas (4)' })).toBeVisible();
});

test('contraseña de acceso y publicación', async ({ page }) => {
	await page.goto(assessmentUrl);
	await page.getByRole('button', { name: 'Publicar' }).click();
	await expect(page.getByRole('alert')).toContainText('Defina la contraseña de acceso.');

	await page.getByLabel('Contraseña', { exact: true }).fill('acceso-2026');
	await page.getByLabel('Repetir contraseña').fill('otra-cosa');
	await page.getByRole('button', { name: 'Guardar', exact: true }).click();
	await expect(page.getByText('Las contraseñas no coinciden.')).toBeVisible();

	await page.getByLabel('Contraseña', { exact: true }).fill('acceso-2026');
	await page.getByLabel('Repetir contraseña').fill('acceso-2026');
	await page.getByRole('button', { name: 'Guardar', exact: true }).click();
	await expect(page.getByText('Contraseña de acceso actualizada.')).toBeVisible();

	await page.getByRole('button', { name: 'Publicar' }).click();
	await expect(page.getByText('Estado actualizado: Publicado.')).toBeVisible();
	await expect(page.getByRole('link', { name: /\/a\/[a-z0-9]{12}/ })).toHaveCount(0);
	await expect(page.locator('code')).toHaveText(/\/a\/[a-km-np-z2-9]{12}$/);
});

test('editar datos generales valida las fechas', async ({ page }) => {
	await page.goto(assessmentUrl);
	await page.getByLabel('Inicio').fill('2026-12-10T08:00');
	await page.getByLabel('Finalización').fill('2026-12-01T08:00');
	await page.getByRole('button', { name: 'Guardar cambios' }).click();
	await expect(page.getByText('La finalización debe ser posterior al inicio.')).toBeVisible();

	await page.getByLabel('Finalización').fill('2026-12-20T18:00');
	await page.getByRole('button', { name: 'Guardar cambios' }).click();
	await expect(page.getByText('Cambios guardados.')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Inicio')).toHaveValue('2026-12-10T08:00');
});

test('las preguntas se bloquean cuando hay respuestas y se puede duplicar', async ({ page }) => {
	// Simula que un participante ya empezó (el flujo real llega en la fase 4).
	const id = assessmentUrl.split('/').pop()!;
	const db = createDb(E2E_DB);
	const p = db
		.insert(participants)
		.values({ assessmentId: id, name: 'Ana', email: 'ana@e2e.test' })
		.returning()
		.get();
	db.insert(submissions).values({ assessmentId: id, participantId: p.id }).run();
	db.$client.close();

	await page.goto(`${assessmentUrl}/preguntas`);
	await expect(page.getByText('las preguntas no se pueden modificar')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Guardar preguntas' })).toHaveCount(0);
	await expect(page.getByText('(opción correcta)')).toHaveCount(2);

	await page.getByRole('button', { name: 'Duplicar assessment' }).click();
	await expect(page).toHaveURL(/\?duplicado=1$/);
	await expect(
		page.getByRole('heading', { name: 'Copia de Seguridad de la información' })
	).toBeVisible();
	await expect(page.getByText('Borrador', { exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Preguntas (4)' }).click();
	await expect(page.getByRole('button', { name: 'Guardar preguntas' })).toBeVisible();
});

test('archivar oculta el assessment de la lista', async ({ page }) => {
	const titulo = 'Assessment para archivar';
	const url = await crearAssessment(page, titulo);
	await page.goto(url);
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Archivar' }).click();
	await expect(page.getByText('Estado actualizado: Archivado.')).toBeVisible();

	await page.goto('/admin');
	await expect(page.getByRole('link', { name: titulo })).toHaveCount(0);
	await page.getByRole('link', { name: 'Mostrar archivados' }).click();
	await expect(page.getByRole('link', { name: titulo })).toBeVisible();
});

test('eliminar un assessment de prueba exige escribir su título', async ({ page }) => {
	const titulo = 'Assessment de prueba para eliminar';
	const url = await crearAssessment(page, titulo);
	await page.goto(url);

	const boton = page.getByRole('button', { name: 'Eliminar definitivamente' });
	await expect(page.getByText('No se puede deshacer.')).toBeVisible();
	await expect(boton).toBeDisabled();
	await page.getByLabel('Para confirmar, escriba el título').fill('otro título');
	await expect(boton).toBeDisabled();

	await page.getByLabel('Para confirmar, escriba el título').fill(titulo);
	page.once('dialog', (d) => d.accept());
	await boton.click();
	await expect(page).toHaveURL(/\/admin\?eliminado=1$/);
	await expect(page.getByText('Assessment eliminado.')).toBeVisible();
	await expect(page.getByRole('link', { name: titulo })).toHaveCount(0);

	const res = await page.goto(url);
	expect(res?.status()).toBe(404);
});

test('un id inexistente devuelve 404', async ({ page }) => {
	const res = await page.goto('/admin/assessments/00000000-0000-0000-0000-000000000000');
	expect(res?.status()).toBe(404);
	const res2 = await page.goto('/admin/assessments/no-es-uuid');
	expect(res2?.status()).toBe(404);
});
