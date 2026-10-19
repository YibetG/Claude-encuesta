import { copyFileSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createDb } from '../../src/lib/server/db/client';
import { adminUsers } from '../../src/lib/server/db/schema';
import { assessmentFormSchema } from '../../src/lib/schemas/assessment';
import { participantSchema } from '../../src/lib/schemas/participant';
import {
	createAssessment,
	getAssessment,
	setAccessPassword,
	setStatus
} from '../../src/lib/server/services/assessments';
import { replaceQuestions } from '../../src/lib/server/services/questions';
import { upsertParticipants } from '../../src/lib/server/services/participants';
import { toLocalDateTimeInput } from '../../src/lib/datetime';
import { E2E_ADMIN, E2E_DB, loginAsAdmin } from './fixtures';

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'acceso-participante-1';
const TZ = 'America/Bogota';
const HOUR = 3600 * 1000;

type Created = { id: string; slug: string };
const created: Record<'abierto' | 'futuro' | 'invitados', Created> = {} as never;

/** Crea assessments de prueba directamente en la base E2E (más rápido que por la interfaz). */
test.beforeAll(async () => {
	const db = createDb(E2E_DB);
	const adminId = db
		.select()
		.from(adminUsers)
		.all()
		.find((x) => x.email === E2E_ADMIN.email)!.id;

	async function make(
		key: keyof typeof created,
		accessMode: 'invitados' | 'abierto',
		startOffsetH: number
	) {
		const now = Date.now();
		const a = createAssessment(
			db,
			assessmentFormSchema.parse({
				title: `Participante ${key}`,
				description: 'Evaluación de conceptos clave.',
				instructions: 'Lea cada pregunta con atención.',
				timezone: TZ,
				startsAt: toLocalDateTimeInput(now + startOffsetH * HOUR, TZ),
				endsAt: toLocalDateTimeInput(now + (startOffsetH + 4) * HOUR, TZ),
				accessMode,
				openMaxChars: '8000'
			}),
			adminId
		);
		replaceQuestions(
			db,
			a.id,
			[
				{
					type: 'opcion_unica',
					prompt: '¿Qué garantiza la confidencialidad?',
					required: true,
					options: [
						{ text: 'Que solo accedan personas autorizadas', isCorrect: true },
						{ text: 'Que la información sea pública', isCorrect: false }
					]
				},
				{ type: 'abierta', prompt: 'Describa un caso real.', required: true },
				{ type: 'abierta', prompt: 'Comentarios adicionales.', required: false }
			],
			adminId
		);
		await setAccessPassword(db, a.id, PASSWORD, adminId);
		setStatus(db, getAssessment(db, a.id)!, 'publicado', adminId);
		upsertParticipants(
			db,
			a.id,
			[participantSchema.parse({ name: 'Ana Invitada', email: 'ana@participante.test' })],
			adminId
		);
		created[key] = { id: a.id, slug: a.slug };
	}

	await make('invitados', 'invitados', -1);
	await make('futuro', 'invitados', 24);
	await make('abierto', 'abierto', -1);
	db.$client.close();
});

async function enter(page: Page, slug: string, email: string, password = PASSWORD) {
	await page.goto(`/a/${slug}`);
	await page.getByLabel('Contraseña de acceso').fill(password);
	await page.getByLabel('Su correo electrónico').fill(email);
	await page.getByRole('button', { name: 'Ingresar' }).click();
}

test('ingreso: contraseña incorrecta, email no invitado y acceso correcto', async ({ page }) => {
	const { slug } = created.invitados;
	await enter(page, slug, 'ana@participante.test', 'equivocada');
	await expect(page.getByRole('alert')).toHaveText('La contraseña de acceso no es correcta.');

	await enter(page, slug, 'otra@participante.test');
	await expect(page.getByRole('alert')).toContainText('no está en la lista de invitados');

	await enter(page, slug, 'ANA@participante.test');
	await expect(page).toHaveURL(new RegExp(`/a/${slug}/responder$`));
	await expect(page.getByText('Ana Invitada · 0 de 3 respondidas')).toBeVisible();

	// La opción correcta no viaja al navegador.
	const html = await page.content();
	expect(html).not.toMatch(/isCorrect|is_correct/);

	const cookie = (await page.context().cookies()).find((c) => c.name === 'participant_session');
	expect(cookie).toMatchObject({
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		path: `/a/${slug}`
	});
});

test('autoguardado, contador de caracteres y continuar después', async ({ page, browser }) => {
	const { slug } = created.invitados;
	await enter(page, slug, 'ana@participante.test');

	await page.getByLabel('Que solo accedan personas autorizadas').check();
	await expect(page.getByRole('status')).toContainText('Guardado');

	const texto = 'Un correo de phishing reportado a tiempo.';
	await page.getByLabel('2. Describa un caso real.').fill(texto);
	await expect(page.getByText(`${texto.length} / 8.000 caracteres`)).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Guardado', { timeout: 10_000 });
	await expect(page.getByText('Ana Invitada · 2 de 3 respondidas')).toBeVisible();

	// "Sale" y vuelve desde otro navegador: continúa donde quedó.
	const other = await browser.newContext();
	const page2 = await other.newPage();
	await enter(page2, slug, 'ana@participante.test');
	await expect(page2).toHaveURL(/\/responder$/);
	await expect(page2.getByLabel('Que solo accedan personas autorizadas')).toBeChecked();
	await expect(page2.getByLabel('2. Describa un caso real.')).toHaveValue(texto);
	await other.close();

	// Con la sesión activa, abrir el link lleva directo a responder.
	await page.goto(`/a/${slug}`);
	await expect(page).toHaveURL(/\/responder$/);
});

test('entrega única con validación de obligatorias', async ({ page }) => {
	const { slug } = created.invitados;
	await enter(page, slug, 'ana@participante.test');
	page.on('dialog', (d) => d.accept());

	// Se borra la respuesta obligatoria abierta y se intenta entregar.
	await page.getByLabel('2. Describa un caso real.').fill('');
	await page.getByRole('button', { name: 'Entregar respuestas' }).click();
	await expect(page.getByRole('alert')).toHaveText('Falta responder la pregunta obligatoria 2.');

	await page.getByLabel('2. Describa un caso real.').fill('Respuesta final.');
	await page.getByRole('button', { name: 'Entregar respuestas' }).click();
	await expect(page).toHaveURL(new RegExp(`/a/${slug}/entregado$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'¡Gracias! Sus respuestas fueron entregadas'
	);

	// La sesión se cerró: volver a "responder" lleva al ingreso, y no puede entregar otra vez.
	await page.goto(`/a/${slug}/responder`);
	await expect(page).toHaveURL(new RegExp(`/a/${slug}$`));
	await enter(page, slug, 'ana@participante.test');
	await expect(page.getByRole('alert')).toContainText('ya entregó sus respuestas');
});

test('fuera de fechas muestra un mensaje claro', async ({ page }) => {
	await page.goto(`/a/${created.futuro.slug}`);
	await expect(page.getByText('Aún no está disponible.')).toBeVisible();
	await expect(page.getByLabel('Contraseña de acceso')).toHaveCount(0);

	const res = await page.goto('/a/noexiste1234');
	expect(res?.status()).toBe(404);
});

test('modo abierto: registra a una persona nueva con su nombre', async ({ page }) => {
	const { slug } = created.abierto;
	await enter(page, slug, 'nueva@participante.test');
	await expect(page.getByRole('alert')).toHaveText(
		'Es su primer ingreso: escriba su nombre para registrarse.'
	);
	await page.getByLabel('Contraseña de acceso').fill(PASSWORD);
	await page.getByLabel('Nombre completo').fill('Persona Nueva');
	await page.getByRole('button', { name: 'Ingresar' }).click();
	await expect(page).toHaveURL(/\/responder$/);
	await expect(page.getByText('Persona Nueva · 0 de 3 respondidas')).toBeVisible();
});

test('el admin ve los estados y las preguntas quedan bloqueadas', async ({ page }) => {
	await loginAsAdmin(page);
	await page.goto(`/admin/assessments/${created.invitados.id}/participantes`);
	await expect(page.getByRole('row', { name: /Ana Invitada.*Completado/ })).toBeVisible();

	await page.goto(`/admin/assessments/${created.abierto.id}/participantes`);
	await expect(page.getByRole('row', { name: /Persona Nueva.*En progreso/ })).toBeVisible();
	await expect(page.getByText('(ingreso abierto)')).toBeVisible();

	await page.goto(`/admin/assessments/${created.invitados.id}/preguntas`);
	await expect(page.getByText('las preguntas no se pueden modificar')).toBeVisible();
});

test('el reporte refleja la entrega: alineación, opciones y respuestas abiertas', async ({
	page
}) => {
	await loginAsAdmin(page);
	await page.goto(`/admin/assessments/${created.invitados.id}/reportes`);

	const tile = (label: string) => page.locator('dt', { hasText: label }).locator('xpath=../dd');
	await expect(tile('Participantes')).toHaveText('1');
	await expect(tile('Entregas')).toHaveText('1');
	await expect(tile('Tasa de participación')).toHaveText('100%');
	await expect(page.getByText('Alineación promedio').locator('xpath=..')).toContainText('100%');

	const q1 = page.locator('#pregunta-1');
	await expect(q1).toContainText('1 persona respondió · 1 eligió la opción esperada');
	await expect(q1.getByText('✓ Esperada')).toBeVisible();
	await expect(q1.getByRole('listitem').filter({ hasText: 'Que solo accedan' })).toContainText(
		'1 · 100%'
	);
	await expect(q1.getByRole('listitem').filter({ hasText: 'pública' })).toContainText('0 · 0%');

	const q2 = page.locator('#pregunta-2');
	await q2.getByText('Ver 1 respuesta').click();
	await expect(q2.getByText('Respuesta final.')).toBeVisible();
	await expect(q2.getByText('Ana Invitada')).toBeVisible();

	await expect(page.getByRole('row', { name: /Ana Invitada.*Completado/ })).toBeVisible();

	// Sin ANTHROPIC_API_KEY (entorno de pruebas) el análisis con IA explica cómo habilitarlo.
	await expect(page.getByText('Análisis global de las preguntas abiertas')).toBeVisible();
	await expect(page.getByText('configure ANTHROPIC_API_KEY').first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Analizar con IA' })).toHaveCount(0);
});

test('descarga el informe en Excel y PDF, y queda en la auditoría', async ({ page }) => {
	await loginAsAdmin(page);
	await page.goto(`/admin/assessments/${created.invitados.id}/reportes`);

	const [excel] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('link', { name: 'Descargar Excel' }).click()
	]);
	expect(excel.suggestedFilename()).toMatch(
		/^informe-participante-invitados-\d{4}-\d{2}-\d{2}\.xlsx$/
	);
	const xlsxPath = test.info().outputPath('informe.xlsx');
	await excel.saveAs(xlsxPath);
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(xlsxPath);
	expect(wb.worksheets.map((w) => w.name)).toEqual([
		'Resumen',
		'Por pregunta',
		'Por participante',
		'Respuestas abiertas'
	]);
	expect(wb.getWorksheet('Respuestas abiertas')!.getRow(2).getCell(7).value).toBe(
		'Respuesta final.'
	);

	const [pdf] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('link', { name: 'Descargar PDF' }).click()
	]);
	expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
	const pdfPath = test.info().outputPath('informe.pdf');
	await pdf.saveAs(pdfPath);
	expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');
	// Copia para revisión manual.
	copyFileSync(pdfPath, 'test-results/ultimo-informe.pdf');

	await page.goto('/admin/auditoria');
	await expect(page.getByRole('row', { name: /Reporte exportado.*formato: Excel/ })).toBeVisible();
	await expect(page.getByRole('row', { name: /Reporte exportado.*formato: PDF/ })).toBeVisible();
});
