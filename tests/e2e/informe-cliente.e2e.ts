import { expect, test } from '@playwright/test';
import { createDb } from '../../src/lib/server/db/client';
import { adminUsers, answers, submissions } from '../../src/lib/server/db/schema';
import { assessmentFormSchema } from '../../src/lib/schemas/assessment';
import { participantSchema } from '../../src/lib/schemas/participant';
import {
	createAssessment,
	getAssessment,
	setStatus
} from '../../src/lib/server/services/assessments';
import { createClient } from '../../src/lib/server/services/clients';
import { listQuestionsForAdmin, replaceQuestions } from '../../src/lib/server/services/questions';
import { listParticipants, upsertParticipants } from '../../src/lib/server/services/participants';
import { E2E_ADMIN, E2E_DB, loginAsAdmin } from './fixtures';

let clientId = '';

/** Cliente con dos assessments publicados y entregas (acierto 50 % y 100 %). */
test.beforeAll(() => {
	const db = createDb(E2E_DB);
	const adminId = db
		.select()
		.from(adminUsers)
		.all()
		.find((x) => x.email === E2E_ADMIN.email)!.id;
	clientId = createClient(db, `Informe S.A. ${Date.now()}`, adminId).id;

	for (const [title, start, picks] of [
		['Medición de enero', '2026-01-10T08:00', ['Sí', 'No']],
		['Medición de junio', '2026-06-10T08:00', ['Sí', 'Sí']]
	] as const) {
		const a = createAssessment(
			db,
			assessmentFormSchema.parse({
				title,
				clientId,
				timezone: 'America/Bogota',
				startsAt: start,
				endsAt: '2026-12-31T18:00',
				accessMode: 'invitados',
				openMaxChars: '8000'
			}),
			adminId
		);
		const opts = () => [
			{ text: 'Sí', isCorrect: true },
			{ text: 'No', isCorrect: false }
		];
		replaceQuestions(
			db,
			a.id,
			[
				{ type: 'opcion_unica', prompt: 'P1', required: true, options: opts() },
				{ type: 'opcion_unica', prompt: 'P2', required: true, options: opts() }
			],
			adminId
		);
		setStatus(db, getAssessment(db, a.id)!, 'publicado', adminId);
		upsertParticipants(
			db,
			a.id,
			[participantSchema.parse({ name: 'Ana', email: 'ana@informe.test', area: 'Ventas' })],
			adminId
		);
		const qs = listQuestionsForAdmin(db, a.id);
		const s = db
			.insert(submissions)
			.values({
				assessmentId: a.id,
				participantId: listParticipants(db, a.id)[0].id,
				submittedAt: new Date()
			})
			.returning()
			.get();
		picks.forEach((text, i) =>
			db
				.insert(answers)
				.values({
					submissionId: s.id,
					questionId: qs[i].id,
					optionId: qs[i].options.find((o) => o.text === text)!.id
				})
				.run()
		);
	}
	db.$client.close();
});

test('informe general del cliente con descargas', async ({ page }) => {
	await loginAsAdmin(page);
	await page.goto(`/admin/clientes/${clientId}`);
	await page.getByRole('link', { name: 'Ver informe general' }).click();
	await expect(
		page.getByRole('heading', { name: /^Informe general de Informe S\.A\./ })
	).toBeVisible();

	// Resumen: 2 assessments, 1 persona, acierto promedio (50 % + 100 %) / 2 = 75 %.
	await expect(page.getByText('2 con entregas')).toBeVisible();
	await expect(page.getByText('distintas, por correo')).toBeVisible();
	await expect(page.locator('dd').filter({ hasText: /^\s*75\s?%\s*$/ })).toBeVisible();

	// Tabla en orden de fecha y por área con la evolución.
	const filas = page.getByRole('region', { name: 'Assessments' }).getByRole('row');
	await expect(filas.nth(1)).toContainText('Medición de enero');
	await expect(filas.nth(2)).toContainText('Medición de junio');
	const area = page.getByRole('region', { name: 'Por área' });
	await expect(area.getByRole('row', { name: /Ventas/ })).toContainText('2');

	// Descargas (quedan en la auditoría).
	for (const [name, type] of [
		['Descargar Excel', 'spreadsheetml'],
		['Descargar PDF', 'application/pdf']
	] as const) {
		const href = await page.getByRole('link', { name }).getAttribute('href');
		const res = await page.request.get(href!);
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain(type);
		expect(res.headers()['content-disposition']).toContain('informe-general-informe-s-a');
	}
	await page.goto('/admin/auditoria');
	await expect(page.getByText('general del cliente').first()).toBeVisible();
});
