import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { adminUsers, answers, submissions } from '../db/schema';
import { assessmentFormSchema } from '../../schemas/assessment';
import { participantSchema } from '../../schemas/participant';
import { createAssessment, getAssessment, setStatus } from './assessments';
import { createClient } from './clients';
import { listQuestionsForAdmin, QuestionsLockedError, replaceQuestions } from './questions';
import { listParticipants, upsertParticipants } from './participants';
import { createNextMeasurement, inSharedSeries, seriesMembers } from './series';
import { buildComparison } from './comparison';
import ExcelJS from 'exceljs';
import { buildComparisonExcel, buildComparisonPdf } from '../export/comparison-export';

let db: ReturnType<typeof createTestDb>;
let adminId: string;

beforeEach(() => {
	db = createTestDb();
	adminId = db
		.insert(adminUsers)
		.values({ email: 'a@b.co', name: 'Admin', passwordHash: 'x' })
		.returning()
		.get().id;
});

function baseAssessment(clientId: string | null = null) {
	const a = createAssessment(
		db,
		assessmentFormSchema.parse({
			title: 'Diagnóstico',
			clientId: clientId ?? '',
			instructions: 'Responda con calma',
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
		{ text: 'No', isCorrect: false },
		{ text: 'No sé', isCorrect: false }
	];
	replaceQuestions(
		db,
		a.id,
		[
			{ type: 'opcion_unica', prompt: 'P1', required: true, options: opts() },
			{ type: 'opcion_unica', prompt: 'P2', required: true, options: opts() },
			{ type: 'abierta', prompt: '¿Qué aprendió?', required: false }
		],
		adminId
	);
	upsertParticipants(
		db,
		a.id,
		[
			['Ana', 'ana@x.co', 'TI'],
			['Eva', 'eva@x.co', 'Finanzas'],
			['Luis', 'luis@x.co', 'TI']
		].map(([name, email, area]) => participantSchema.parse({ name, email, area })),
		adminId
	);
	return a;
}

function respond(assessmentId: string, name: string, p1: string, p2: string, text?: string) {
	const qs = listQuestionsForAdmin(db, assessmentId);
	const pid = listParticipants(db, assessmentId).find((p) => p.name === name)!.id;
	const s = db
		.insert(submissions)
		.values({ participantId: pid, assessmentId, submittedAt: new Date() })
		.returning()
		.get();
	[p1, p2].forEach((t, i) =>
		db
			.insert(answers)
			.values({
				submissionId: s.id,
				questionId: qs[i].id,
				optionId: qs[i].options.find((o) => o.text === t)!.id
			})
			.run()
	);
	if (text) db.insert(answers).values({ submissionId: s.id, questionId: qs[2].id, text }).run();
}

describe('series de mediciones', () => {
	it('la siguiente medición copia preguntas, cliente y participantes, en borrador', () => {
		const client = createClient(db, 'Acme', adminId);
		const pre = baseAssessment(client.id);
		setStatus(db, getAssessment(db, pre.id)!, 'publicado', adminId);

		const post = createNextMeasurement(db, pre.id, adminId)!;
		expect(post).toMatchObject({
			title: 'Diagnóstico · Medición 2',
			status: 'borrador',
			clientId: client.id,
			seriesId: pre.id,
			seriesOrder: 2,
			instructions: 'Responda con calma',
			accessPasswordHash: null
		});
		expect(post.startsAt.getTime()).toBeGreaterThan(pre.endsAt.getTime());
		expect(getAssessment(db, pre.id)).toMatchObject({ seriesId: pre.id, seriesOrder: 1 });

		const qs = listQuestionsForAdmin(db, post.id);
		expect(qs.map((q) => q.prompt)).toEqual(['P1', 'P2', '¿Qué aprendió?']);
		expect(qs[0].options.find((o) => o.isCorrect)?.text).toBe('Sí');
		const people = listParticipants(db, post.id);
		expect(people.map((p) => p.email).sort()).toEqual(['ana@x.co', 'eva@x.co', 'luis@x.co']);
		expect(people.every((p) => p.status === 'pendiente')).toBe(true);

		// La tercera se numera aunque se cree desde la primera, y el título no se repite.
		const third = createNextMeasurement(db, pre.id, adminId)!;
		expect(third.title).toBe('Diagnóstico · Medición 3');
		expect(seriesMembers(db, third).map((m) => m.seriesOrder)).toEqual([1, 2, 3]);
	});

	it('en una serie las preguntas no se pueden modificar', () => {
		const pre = baseAssessment();
		expect(inSharedSeries(db, pre.id)).toBe(false);
		const post = createNextMeasurement(db, pre.id, adminId)!;
		expect(inSharedSeries(db, pre.id)).toBe(true);
		for (const id of [pre.id, post.id]) {
			expect(() => replaceQuestions(db, id, [], adminId)).toThrow(QuestionsLockedError);
		}
	});
});

describe('comparativo entre mediciones', () => {
	function scenario() {
		const pre = baseAssessment();
		setStatus(db, getAssessment(db, pre.id)!, 'publicado', adminId);
		const post = createNextMeasurement(db, pre.id, adminId)!;
		setStatus(db, getAssessment(db, post.id)!, 'publicado', adminId);
		// Antes: Ana 1/2, Eva 0/2, Luis 2/2. Después: Ana 2/2, Eva 1/2 (Luis no respondió).
		respond(pre.id, 'Ana', 'Sí', 'No', 'Poco');
		respond(pre.id, 'Eva', 'No', 'No sé');
		respond(pre.id, 'Luis', 'Sí', 'Sí');
		respond(post.id, 'Ana', 'Sí', 'Sí', 'Mucho');
		respond(post.id, 'Eva', 'Sí', 'No');
		return { pre, post };
	}

	it('pareado: solo quienes respondieron ambas, con la mejora por persona y pregunta', () => {
		const { pre } = scenario();
		const c = buildComparison(db, getAssessment(db, pre.id)!);
		expect(c.measurements.map((m) => m.submitted)).toEqual([2, 2]);
		expect(c.summary.paired).toBe(2);
		expect(c.summary.firstScore).toBeCloseTo(0.25);
		expect(c.summary.lastScore).toBeCloseTo(0.75);
		expect(c.summary.delta).toBeCloseTo(0.5);

		const [p1, p2] = c.choice;
		expect(p1.rates).toEqual([0.5, 1]);
		expect(p1.transitions).toEqual({ improved: 1, keptRight: 1, worsened: 0, keptWrong: 0 });
		expect(p2.rates).toEqual([0, 0.5]);
		expect(p2.transitions).toEqual({ improved: 1, keptRight: 0, worsened: 0, keptWrong: 1 });
		expect(p2.options.map((o) => o.rates)).toEqual([
			[0, 0.5],
			[0.5, 0.5],
			[0.5, 0]
		]);

		expect(c.people.map((p) => [p.name, p.scores, p.delta])).toEqual([
			['Ana', [0.5, 1], 0.5],
			['Eva', [0, 0.5], 0.5]
		]);
		expect(c.byArea.map((g) => [g.name, g.scores])).toEqual([
			['Finanzas', [0, 0.5]],
			['TI', [0.5, 1]]
		]);
		expect(c.open[0].responses).toEqual([
			{ email: 'ana@x.co', name: 'Ana', texts: ['Poco', 'Mucho'] }
		]);
	});

	it('todos: cada medición con todas sus entregas', () => {
		const { pre } = scenario();
		const c = buildComparison(db, getAssessment(db, pre.id)!, { mode: 'todos' });
		expect(c.measurements.map((m) => m.submitted)).toEqual([3, 2]);
		expect(c.summary.firstScore).toBeCloseTo(0.5);
		expect(c.choice[0].transitions).toBeNull();
		expect(c.people.find((p) => p.name === 'Luis')).toMatchObject({
			scores: [1, null],
			delta: null
		});
	});

	it('se pueden elegir las mediciones; los borradores no entran por defecto', () => {
		const { pre, post } = scenario();
		const third = createNextMeasurement(db, post.id, adminId)!;
		const c = buildComparison(db, getAssessment(db, pre.id)!);
		expect(c.series.map((s) => s.order)).toEqual([1, 2, 3]);
		expect(c.measurements.map((m) => m.id)).toEqual([pre.id, post.id]);
		const solo = buildComparison(db, getAssessment(db, pre.id)!, {
			selectedIds: [post.id, third.id]
		});
		expect(solo.measurements.map((m) => m.id)).toEqual([post.id, third.id]);
	});
	it('exporta el comparativo a Excel y PDF', async () => {
		const { pre } = scenario();
		const c = buildComparison(db, getAssessment(db, pre.id)!);
		const meta = { title: 'Diagnóstico', generatedAt: 'hoy' };
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(await buildComparisonExcel(meta, c));
		expect(wb.worksheets.map((w) => w.name)).toEqual([
			'Resumen',
			'Por pregunta',
			'Por persona',
			'Por área',
			'Por cargo',
			'Respuestas abiertas'
		]);
		const preguntas = wb.getWorksheet('Por pregunta')!;
		expect(preguntas.getRow(2).values).toEqual([undefined, 1, 'P1', 0.5, 1, 50, 1, 1, 0, 0]);
		const pdf = await buildComparisonPdf(meta, c);
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
	});
});
