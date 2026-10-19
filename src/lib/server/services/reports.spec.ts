import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { adminUsers, answers, submissions } from '../db/schema';
import { assessmentFormSchema } from '../../schemas/assessment';
import { participantSchema } from '../../schemas/participant';
import { createAssessment } from './assessments';
import { listQuestionsForAdmin, replaceQuestions } from './questions';
import { listParticipants, upsertParticipants } from './participants';
import { buildReport } from './reports';
import { formatPercent } from '../../format';

let db: ReturnType<typeof createTestDb>;
let assessmentId: string;

/**
 * Escenario:
 *  P1 (2 opciones, esperada A), P2 (3 opciones, esperada C), P3 abierta, P4 opcional (esperada X).
 *  Ana (TI), Luis (TI), Eva (Finanzas) entregaron; Teo (Finanzas) está en progreso; Sol nunca entró.
 */
beforeAll(() => {
	db = createTestDb();
	const adminId = db
		.insert(adminUsers)
		.values({ email: 'a@b.co', name: 'Admin', passwordHash: 'x' })
		.returning()
		.get().id;
	assessmentId = createAssessment(
		db,
		assessmentFormSchema.parse({
			title: 'Reporte',
			description: '',
			instructions: '',
			timezone: 'America/Bogota',
			startsAt: '2026-11-01T08:00',
			endsAt: '2026-11-15T18:00',
			accessMode: 'invitados',
			openMaxChars: '8000'
		}),
		adminId
	).id;
	const opt = (text: string, isCorrect = false) => ({ text, isCorrect });
	replaceQuestions(
		db,
		assessmentId,
		[
			{ type: 'opcion_unica', prompt: 'P1', required: true, options: [opt('A', true), opt('B')] },
			{
				type: 'opcion_unica',
				prompt: 'P2',
				required: true,
				options: [opt('A'), opt('B'), opt('C', true)]
			},
			{ type: 'abierta', prompt: 'P3', required: true },
			{ type: 'opcion_unica', prompt: 'P4', required: false, options: [opt('X', true), opt('Y')] }
		],
		adminId
	);
	const people = [
		['Ana', 'ana@x.co', 'TI'],
		['Luis', 'luis@x.co', 'TI'],
		['Eva', 'eva@x.co', 'Finanzas'],
		['Teo', 'teo@x.co', 'Finanzas'],
		['Sol', 'sol@x.co', 'Finanzas']
	].map(([name, email, area]) => participantSchema.parse({ name, email, area }));
	upsertParticipants(db, assessmentId, people, adminId);

	const qs = listQuestionsForAdmin(db, assessmentId);
	const optId = (q: number, text: string) => qs[q].options.find((o) => o.text === text)!.id;
	const ps = Object.fromEntries(listParticipants(db, assessmentId).map((p) => [p.name, p.id]));

	function respond(
		name: string,
		submitted: boolean,
		a: { p1?: string; p2?: string; p3?: string; p4?: string }
	) {
		const s = db
			.insert(submissions)
			.values({ participantId: ps[name], assessmentId, submittedAt: submitted ? new Date() : null })
			.returning()
			.get();
		const rows = [
			a.p1 && { questionId: qs[0].id, optionId: optId(0, a.p1) },
			a.p2 && { questionId: qs[1].id, optionId: optId(1, a.p2) },
			a.p3 && { questionId: qs[2].id, text: a.p3 },
			a.p4 && { questionId: qs[3].id, optionId: optId(3, a.p4) }
		].filter(Boolean) as { questionId: string; optionId?: string; text?: string }[];
		for (const r of rows)
			db.insert(answers)
				.values({ submissionId: s.id, ...r })
				.run();
	}

	respond('Ana', true, { p1: 'A', p2: 'C', p3: 'Texto de Ana', p4: 'X' });
	respond('Luis', true, { p1: 'A', p2: 'B', p3: 'Texto de Luis' });
	respond('Eva', true, { p1: 'B', p2: 'C', p3: 'Texto de Eva', p4: 'Y' });
	respond('Teo', false, { p1: 'B', p2: 'A', p3: 'Borrador' }); // en progreso: no cuenta
});

describe('reporte', () => {
	it('resume participación y alineación promedio', () => {
		const r = buildReport(db, assessmentId);
		expect(r.summary).toMatchObject({ invited: 5, inProgress: 1, submitted: 3 });
		expect(r.summary.participationRate).toBeCloseTo(3 / 5);
		// P1 2/3, P2 2/3, P4 1/2 → promedio 0.6111
		expect(r.summary.averageAlignment).toBeCloseTo((2 / 3 + 2 / 3 + 1 / 2) / 3);
	});

	it('cuenta por opción solo las entregas finales y marca la esperada', () => {
		const r = buildReport(db, assessmentId);
		const [p1, p2, p4] = r.choice;
		expect(p1.options.map((o) => [o.text, o.count, o.isExpected])).toEqual([
			['A', 2, true],
			['B', 1, false]
		]);
		expect(p1).toMatchObject({ number: 1, respondents: 3, aligned: 2, omitted: 0 });
		expect(p1.alignmentRate).toBeCloseTo(2 / 3);
		expect(p2.options.map((o) => o.count)).toEqual([0, 1, 2]);
		// P4 es opcional: Luis no la respondió.
		expect(p4).toMatchObject({ number: 4, respondents: 2, omitted: 1, aligned: 1 });
		expect(p4.options[0].rate).toBe(0.5);
	});

	it('lista las respuestas abiertas completas con su autor (sin borradores)', () => {
		const r = buildReport(db, assessmentId);
		expect(r.open).toHaveLength(1);
		expect(r.open[0].number).toBe(3);
		expect(r.open[0].responses.map((x) => [x.participantName, x.text])).toEqual([
			['Ana', 'Texto de Ana'],
			['Eva', 'Texto de Eva'],
			['Luis', 'Texto de Luis']
		]);
	});

	it('ordena las preguntas con más y menos alineación', () => {
		const r = buildReport(db, assessmentId);
		expect(r.summary.mostAligned.map((c) => c.number)).toEqual([1]);
		expect(r.summary.leastAligned.map((c) => c.number)).toEqual([4]);
	});

	it('filtra por área', () => {
		const r = buildReport(db, assessmentId, { area: 'TI' });
		expect(r.summary).toMatchObject({ invited: 2, submitted: 2, inProgress: 0 });
		expect(r.choice[0].alignmentRate).toBe(1);
		expect(r.choice[1].alignmentRate).toBe(0.5);
		expect(r.open[0].responses).toHaveLength(2);
	});

	it('sin entregas, las tasas quedan vacías (no 0 %)', () => {
		const r = buildReport(db, assessmentId, { area: 'Inexistente' });
		expect(r.summary.participationRate).toBeNull();
		expect(r.summary.averageAlignment).toBeNull();
		expect(r.choice[0].alignmentRate).toBeNull();
		expect(formatPercent(r.choice[0].alignmentRate)).toBe('—');
	});

	it('formatea porcentajes en español', () => {
		expect(formatPercent(2 / 3)).toBe('67%');
		expect(formatPercent(0.6111, 1)).toBe('61,1%');
	});
});
