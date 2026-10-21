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
import { listQuestionsForAdmin, replaceQuestions } from '../../src/lib/server/services/questions';
import { listParticipants, upsertParticipants } from '../../src/lib/server/services/participants';
import { E2E_ADMIN, E2E_DB, loginAsAdmin } from './fixtures';

test.describe.configure({ mode: 'serial' });

let preId = '';
let adminId = '';

/** Entregas directas en la base: Ana y Eva responden P1 y P2 (esperada "Sí"). */
function respond(assessmentId: string, picks: Record<string, [string, string]>) {
	const db = createDb(E2E_DB);
	const qs = listQuestionsForAdmin(db, assessmentId);
	for (const p of listParticipants(db, assessmentId)) {
		const chosen = picks[p.name];
		if (!chosen) continue;
		const s = db
			.insert(submissions)
			.values({ assessmentId, participantId: p.id, submittedAt: new Date() })
			.returning()
			.get();
		chosen.forEach((text, i) =>
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
}

test.beforeAll(() => {
	const db = createDb(E2E_DB);
	adminId = db
		.select()
		.from(adminUsers)
		.all()
		.find((x) => x.email === E2E_ADMIN.email)!.id;
	const a = createAssessment(
		db,
		assessmentFormSchema.parse({
			title: 'Cultura de seguridad',
			timezone: 'America/Bogota',
			startsAt: '2026-01-10T08:00',
			endsAt: '2026-01-20T18:00',
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
			{ type: 'opcion_unica', prompt: '¿Bloquea su equipo?', required: true, options: opts() },
			{
				type: 'opcion_unica',
				prompt: '¿Reporta los correos raros?',
				required: true,
				options: opts()
			}
		],
		adminId
	);
	upsertParticipants(
		db,
		a.id,
		[
			participantSchema.parse({ name: 'Ana', email: 'ana@medicion.test', area: 'TI' }),
			participantSchema.parse({ name: 'Eva', email: 'eva@medicion.test', area: 'Ventas' })
		],
		adminId
	);
	setStatus(db, getAssessment(db, a.id)!, 'publicado', adminId);
	preId = a.id;
	db.$client.close();
	respond(preId, { Ana: ['Sí', 'No'], Eva: ['No', 'No'] });
});

test('crear la medición posterior y compararla con la previa', async ({ page }) => {
	await loginAsAdmin(page);
	await page.goto(`/admin/assessments/${preId}`);
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Crear siguiente medición' }).click();
	await expect(page).toHaveURL(/\/admin\/assessments\/[0-9a-f-]{36}\?medicion=1$/);
	await expect(page.getByText('Se creó la nueva medición')).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Cultura de seguridad · Medición 2', level: 1 })
	).toBeVisible();
	const postId = page.url().match(/assessments\/([0-9a-f-]{36})/)![1];

	// Copió preguntas y participantes; las preguntas quedan bloqueadas en ambas mediciones.
	await expect(page.getByRole('link', { name: 'Preguntas (2)' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Participantes (2)' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Mediciones (2)' })).toBeVisible();
	await page.goto(`/admin/assessments/${preId}/preguntas`);
	await expect(page.getByText('es parte de una serie de mediciones')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Guardar preguntas' })).toHaveCount(0);

	// La posterior se responde (las dos mejoran en la pregunta 1).
	const db = createDb(E2E_DB);
	setStatus(db, getAssessment(db, postId)!, 'publicado', adminId);
	db.$client.close();
	respond(postId, { Ana: ['Sí', 'Sí'], Eva: ['Sí', 'No'] });

	await page.goto(`/admin/assessments/${postId}`);
	await page.getByRole('link', { name: 'Ver comparativo' }).click();
	await expect(page).toHaveURL(/\/mediciones$/);

	// Acierto: antes (50 % + 0 %)/2 = 25 %, después (100 % + 50 %)/2 = 75 % → +50 pp.
	await expect(page.getByText('+50 pp').first()).toBeVisible();
	const preguntas = page.getByRole('region', { name: 'Alineación por pregunta' });
	await expect(preguntas.getByRole('row').filter({ hasText: 'Bloquea su equipo' })).toContainText(
		'↑ 1 mejoraron'
	);
	const personas = page.getByRole('region', { name: 'Acierto por persona' });
	await expect(personas.getByRole('row').filter({ hasText: 'ana@medicion.test' })).toContainText(
		'+50 pp'
	);

	// Todas las entregas: también funciona y las descargas siguen el mismo modo.
	await page.getByLabel('Todas las entregas de cada medición').check();
	await page.getByRole('button', { name: 'Actualizar comparativo' }).click();
	await expect(page).toHaveURL(/modo=todos/);
	for (const [name, type] of [
		['Descargar Excel', 'spreadsheetml'],
		['Descargar PDF', 'application/pdf']
	] as const) {
		const href = await page.getByRole('link', { name }).getAttribute('href');
		expect(href).toContain('modo=todos');
		const res = await page.request.get(href!);
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain(type);
	}
});
