import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './fixtures';

test.describe.configure({ mode: 'serial' });

const ACCESS_PASSWORD = 'acceso-e2e-2026';
let base = '';

test.beforeEach(async ({ page }) => {
	await loginAsAdmin(page);
});

test('preparar un assessment publicado', async ({ page }) => {
	await page.goto('/admin/assessments/nuevo');
	await page.getByLabel('Título').fill('Clima de seguridad');
	await page.getByRole('button', { name: 'Crear y agregar preguntas' }).click();
	await expect(page).toHaveURL(/\/preguntas\?creado=1$/);
	base = page.url().replace(/\/preguntas.*$/, '');

	await page.getByRole('button', { name: '+ Pregunta abierta' }).click();
	await page.getByLabel('Enunciado de la pregunta 1').fill('¿Qué mejoraría?');
	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByText('Preguntas guardadas.')).toBeVisible();

	await page.goto(base);
	await page.getByLabel('Contraseña', { exact: true }).fill(ACCESS_PASSWORD);
	await page.getByLabel('Repetir contraseña').fill(ACCESS_PASSWORD);
	await page.getByRole('button', { name: 'Guardar', exact: true }).click();
	await expect(page.getByText('Contraseña de acceso actualizada.')).toBeVisible();
	await page.getByRole('button', { name: 'Publicar' }).click();
	await expect(page.getByText('Estado actualizado: Publicado.')).toBeVisible();
});

test('agregar, cargar, filtrar y eliminar participantes', async ({ page }) => {
	await page.goto(`${base}/participantes`);
	await expect(page.getByText('Todavía no hay participantes.')).toBeVisible();

	await page.getByText('Agregar participante').click();
	await page.getByLabel('Nombre').fill('Ana Pérez');
	await page.getByLabel('Email').fill('ANA@empresa.test');
	await page.getByRole('button', { name: 'Agregar', exact: true }).click();
	await expect(page.getByText('Participante agregado: ana@empresa.test.')).toBeVisible();

	// Email repetido.
	await page.getByText('Agregar participante').click();
	await page.getByLabel('Nombre').fill('Otra Ana');
	await page.getByLabel('Email').fill('ana@empresa.test');
	await page.getByRole('button', { name: 'Agregar', exact: true }).click();
	await expect(
		page.getByText('Ya existe un participante con el email ana@empresa.test.')
	).toBeVisible();

	// Carga CSV (separador ";", con tilde y una columna adicional). Ana se actualiza.
	await page.getByText('Cargar desde Excel o CSV').click();
	await page.getByLabel('Archivo (.xlsx o .csv, máx. 2 MB)').setInputFiles({
		name: 'participantes.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'﻿Nombre;Correo;Área;Cargo;Sede\n' +
				'Ana Pérez;ana@empresa.test;Tecnología;Analista;Bogotá\n' +
				'Luis Gómez;luis@empresa.test;Finanzas;Coordinador;Medellín\n' +
				'Eva Ruiz;eva@empresa.test;Tecnología;Directora;Cali\n'
		)
	});
	await page.getByRole('button', { name: 'Cargar' }).click();
	await expect(page.getByText('Carga completa: 2 nuevos, 1 actualizados.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Participantes (3)' })).toBeVisible();

	// Filtro por área.
	await page.getByLabel('Área', { exact: true }).selectOption('Tecnología');
	await page.getByRole('button', { name: 'Filtrar' }).click();
	await expect(page).toHaveURL(/area=Tecnolog/);
	await expect(page.getByRole('row')).toHaveCount(3); // encabezado + Ana + Eva
	await page.getByRole('link', { name: 'Quitar filtros' }).click();

	// Eliminar a Eva.
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Eliminar a Eva Ruiz' }).click();
	await expect(page.getByRole('link', { name: 'Participantes (2)' })).toBeVisible();
	await expect(page.getByRole('cell', { name: 'eva@empresa.test' })).toHaveCount(0);
});

test('plantilla, envío de invitaciones y mensaje para copiar', async ({ page }) => {
	await page.goto(`${base}/invitaciones`);

	// Vista previa en vivo con el nombre del primer participante.
	await expect(page.getByText('Hola Ana Pérez,')).toBeVisible();

	// La plantilla exige {{enlace}}.
	const body = page.getByLabel('Mensaje', { exact: true });
	const original = await body.inputValue();
	await body.fill('Hola {{nombre}}, su clave es {{contrasena}}');
	await page.getByRole('button', { name: 'Guardar plantilla' }).click();
	await expect(page.getByText('El mensaje debe incluir {{enlace}}.')).toBeVisible();
	await body.fill(original);
	await page.getByRole('button', { name: 'Guardar plantilla' }).click();
	await expect(page.getByText('Plantilla guardada.')).toBeVisible();

	// La contraseña vigente está guardada cifrada: se incluye sola, sin escribirla.
	await expect(
		page.getByText('El mensaje incluirá automáticamente la contraseña de acceso vigente.')
	).toBeVisible();
	await expect(page.getByLabel('Contraseña de acceso vigente')).toHaveCount(0);

	page.on('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Enviar invitaciones' }).click();
	await expect(page.getByText('Se enviaron 2 de 2 invitaciones.')).toBeVisible();
	await expect(page.getByText('Quienes aún no han recibido invitación (0)')).toBeVisible();

	// Mensaje genérico para copiar.
	await page.getByRole('button', { name: 'Generar mensaje' }).click();
	const generic = page.locator('#generic');
	await expect(generic).toHaveValue(/^Invitación: Clima de seguridad\n\nHola,/);
	await expect(generic).toHaveValue(new RegExp(`Contraseña de acceso: ${ACCESS_PASSWORD}`));
	await expect(generic).toHaveValue(/http:\/\/localhost:4173\/a\/[a-z0-9]{12}/);

	// En participantes ya figura la fecha de invitación.
	await page.goto(`${base}/participantes`);
	await expect(page.getByText('No enviada')).toHaveCount(0);

	// La auditoría registra el envío sin la contraseña.
	await page.goto('/admin/auditoria');
	await expect(page.getByRole('cell', { name: 'Invitaciones enviadas' }).first()).toBeVisible();
	await expect(page.getByText(ACCESS_PASSWORD)).toHaveCount(0);
});
