import { expect, test } from '@playwright/test';
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
import { E2E_ADMIN, E2E_DB } from './fixtures';

const PASSWORD = 'acceso-pasos-1';
const TZ = 'America/Bogota';
const HOUR = 3600 * 1000;
let slug = '';

/** 7 preguntas = 3 pasos (3 + 3 + 1). La 5 es la única obligatoria. */
test.beforeAll(async () => {
	const db = createDb(E2E_DB);
	const adminId = db
		.select()
		.from(adminUsers)
		.all()
		.find((x) => x.email === E2E_ADMIN.email)!.id;
	const now = Date.now();
	const a = createAssessment(
		db,
		assessmentFormSchema.parse({
			title: 'Encuesta por pasos',
			description: '',
			instructions: 'Responda con calma.',
			timezone: TZ,
			startsAt: toLocalDateTimeInput(now - HOUR, TZ),
			endsAt: toLocalDateTimeInput(now + 4 * HOUR, TZ),
			accessMode: 'invitados',
			openMaxChars: '2000'
		}),
		adminId
	);
	replaceQuestions(
		db,
		a.id,
		Array.from({ length: 7 }, (_, i) => ({
			type: 'opcion_unica' as const,
			prompt: `Pregunta número ${i + 1}`,
			required: i === 4,
			options: [
				{ text: `Sí ${i + 1}`, isCorrect: true },
				{ text: `No ${i + 1}`, isCorrect: false }
			]
		})),
		adminId
	);
	await setAccessPassword(db, a.id, PASSWORD, adminId);
	setStatus(db, getAssessment(db, a.id)!, 'publicado', adminId);
	upsertParticipants(
		db,
		a.id,
		[participantSchema.parse({ name: 'Pedro Pasos', email: 'pedro@pasos.test' })],
		adminId
	);
	slug = a.slug;
	db.$client.close();
});

test('responder por pasos de 3 preguntas con autoguardado', async ({ page }) => {
	await page.goto(`/a/${slug}`);
	await page.getByLabel('Contraseña de acceso').fill(PASSWORD);
	await page.getByLabel('Su correo electrónico').fill('pedro@pasos.test');
	await page.getByRole('button', { name: 'Ingresar' }).click();
	await expect(page).toHaveURL(/\/responder$/);

	// Paso 1: preguntas 1 a 3, con instrucciones; la 4 está en el paso siguiente.
	await expect(page.getByText('Paso 1 de 3')).toBeVisible();
	await expect(page.getByText('Responda con calma.')).toBeVisible();
	await expect(page.getByText('Pregunta número 3')).toBeVisible();
	await expect(page.getByText('Pregunta número 4')).toBeHidden();
	await expect(page.getByRole('button', { name: 'Entregar respuestas' })).toHaveCount(0);

	await page.getByLabel('Sí 1').check();
	await expect(page.getByRole('status')).toContainText('Guardado');

	// Paso 2.
	await page.getByRole('button', { name: 'Siguiente →' }).click();
	await expect(page.getByText('Paso 2 de 3')).toBeVisible();
	await expect(page.getByText('Preguntas 4 a 6 de 7')).toBeVisible();
	await expect(page.getByText('Pregunta número 1')).toBeHidden();
	await expect(page.getByText('Responda con calma.')).toBeHidden();
	await page.getByLabel('Sí 4').check();
	await expect(page.getByRole('status')).toContainText('Guardado');

	// Paso 3 (último): aparece "Entregar". Falta la obligatoria 5 → vuelve a su paso.
	await page.getByRole('button', { name: 'Siguiente →' }).click();
	await expect(page.getByText('Paso 3 de 3')).toBeVisible();
	page.on('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Entregar respuestas' }).click();
	await expect(page.getByRole('alert')).toHaveText('Falta responder la pregunta obligatoria 5.');
	await expect(page.getByText('Paso 2 de 3')).toBeVisible();
	await expect(page.getByText('Pregunta número 5')).toBeVisible();

	// Lo respondido en otros pasos se conserva (también tras recargar).
	await page.getByLabel('Sí 5').check();
	await expect(page.getByRole('status')).toContainText('Guardado');
	await page.reload();
	await expect(page.getByText('Pedro Pasos · 3 de 7 respondidas')).toBeVisible();
	await page.getByRole('button', { name: /Ir al paso 2/ }).click();
	await expect(page.getByLabel('Sí 5')).toBeChecked();

	await page.getByRole('button', { name: /Ir al paso 3/ }).click();
	await page.getByRole('button', { name: 'Entregar respuestas' }).click();
	await expect(page).toHaveURL(/\/entregado$/);
});
