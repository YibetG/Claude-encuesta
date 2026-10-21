import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { adminUsers, answers, submissions } from '../db/schema';
import { assessmentFormSchema } from '../../schemas/assessment';
import { participantSchema } from '../../schemas/participant';
import { createAssessment, setStatus, getAssessment } from './assessments';
import { createClient } from './clients';
import { listQuestionsForAdmin, replaceQuestions } from './questions';
import { listParticipants, upsertParticipants } from './participants';
import { participantScores } from './reports';
import { buildClientReport } from './client-report';
import ExcelJS from 'exceljs';
import { getClient } from './clients';
import { buildClientExcel, buildClientPdf, clientExportMeta } from '../export/client-export';

let db: ReturnType<typeof createTestDb>;
let clientId: string;
let pre: string;
let post: string;

/**
 * Cliente con dos assessments publicados (antes y después) de dos preguntas de selección
 * (esperada "Sí") y uno en borrador que no cuenta. Ana (TI) y Eva (Finanzas) responden ambos;
 * Luis (TI) solo el primero. Otro cliente con un assessment no debe colarse.
 */
beforeAll(() => {
	db = createTestDb();
	const adminId = db
		.insert(adminUsers)
		.values({ email: 'a@b.co', name: 'Admin', passwordHash: 'x' })
		.returning()
		.get().id;
	clientId = createClient(db, 'Acme', adminId).id;
	const otro = createClient(db, 'Otro', adminId).id;

	const make = (title: string, startsAt: string, client = clientId, publish = true) => {
		const a = createAssessment(
			db,
			assessmentFormSchema.parse({
				title,
				clientId: client,
				timezone: 'America/Bogota',
				startsAt,
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
				{ type: 'opcion_unica', prompt: 'P2', required: true, options: opts() },
				{ type: 'abierta', prompt: 'Comentarios', required: false }
			],
			adminId
		);
		if (publish) setStatus(db, getAssessment(db, a.id)!, 'publicado', adminId);
		return a.id;
	};
	// Se crea primero el posterior para comprobar que se ordenan por fecha de inicio.
	post = make('Después', '2026-12-01T08:00');
	pre = make('Antes', '2026-11-01T08:00');
	make('Borrador', '2026-10-01T08:00', clientId, false);
	const ajeno = make('Ajeno', '2026-11-01T08:00', otro);

	const people = [
		['Ana', 'ana@x.co', 'TI', 'Analista'],
		['Eva', 'eva@x.co', 'Finanzas', ''],
		['Luis', 'luis@x.co', 'TI', 'Analista']
	];
	function respond(assessmentId: string, name: string, p1: string, p2: string) {
		const qs = listQuestionsForAdmin(db, assessmentId);
		const pid = listParticipants(db, assessmentId).find((p) => p.name === name)!.id;
		const s = db
			.insert(submissions)
			.values({ participantId: pid, assessmentId, submittedAt: new Date() })
			.returning()
			.get();
		[p1, p2].forEach((text, i) =>
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
	for (const id of [pre, post, ajeno]) {
		upsertParticipants(
			db,
			id,
			people.map(([name, email, area, cargo]) =>
				participantSchema.parse({ name, email, area, cargo })
			),
			adminId
		);
	}
	respond(pre, 'Ana', 'Sí', 'No'); // 50 %
	respond(pre, 'Eva', 'No', 'No'); // 0 %
	respond(pre, 'Luis', 'Sí', 'Sí'); // 100 %
	respond(post, 'Ana', 'Sí', 'Sí'); // 100 %
	respond(post, 'Eva', 'Sí', 'No'); // 50 %
	respond(ajeno, 'Ana', 'No', 'No');
});

describe('acierto por participante', () => {
	it('cuenta las respuestas con la opción esperada sobre las que respondió', () => {
		const scores = participantScores(db, pre);
		const byName = Object.fromEntries(
			listParticipants(db, pre).map((p) => [p.name, scores.get(p.id)?.rate ?? null])
		);
		expect(byName).toEqual({ Ana: 0.5, Eva: 0, Luis: 1 });
	});
});

describe('informe general del cliente', () => {
	it('lista sus assessments por fecha, sin borradores ni los de otros clientes', () => {
		const r = buildClientReport(db, clientId);
		expect(r.assessments.map((a) => a.title)).toEqual(['Antes', 'Después']);
		expect(r.assessments[0]).toMatchObject({
			participants: 3,
			submitted: 3,
			participationRate: 1,
			averageScore: 0.5
		});
		expect(r.assessments[1]).toMatchObject({ submitted: 2, averageScore: 0.75 });
		// Alineación de "Antes": P1 2/3, P2 1/3 → promedio 0,5.
		expect(r.assessments[0].averageAlignment).toBeCloseTo(0.5);
	});

	it('consolida personas, entregas y acierto', () => {
		const s = buildClientReport(db, clientId).summary;
		expect(s).toMatchObject({
			assessments: 2,
			withSubmissions: 2,
			people: 3,
			participants: 6,
			submitted: 5
		});
		expect(s.participationRate).toBeCloseTo(5 / 6);
		expect(s.averageScore).toBeCloseTo((0.5 + 0 + 1 + 1 + 0.5) / 5);
	});

	it('agrupa por área y cargo, con la evolución por assessment', () => {
		const r = buildClientReport(db, clientId);
		const ti = r.byArea.find((g) => g.name === 'TI')!;
		expect(ti.submissions).toBe(3);
		expect(ti.byAssessment[pre]).toBeCloseTo(0.75);
		expect(ti.byAssessment[post]).toBe(1);
		expect(r.byArea.map((g) => g.name)).toEqual(['TI', 'Finanzas']);
		// Sin cargo: se agrupa como "Sin dato", al final.
		expect(r.byCargo.map((g) => g.name)).toEqual(['Analista', 'Sin dato']);
	});
});

describe('exportaciones del informe general', () => {
	it('genera el Excel con sus cuatro hojas y el PDF', async () => {
		const client = getClient(db, clientId)!;
		const meta = clientExportMeta(db, client);
		const report = buildClientReport(db, clientId);

		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(await buildClientExcel(meta, report));
		expect(wb.worksheets.map((w) => w.name)).toEqual([
			'Resumen',
			'Assessments',
			'Por área',
			'Por cargo'
		]);
		const list = wb.getWorksheet('Assessments')!;
		expect(list.getRow(2).getCell(1).value).toBe('Antes');
		expect(list.getRow(2).getCell(8).value).toBe(0.5);
		const areas = wb.getWorksheet('Por área')!;
		expect(areas.getRow(1).values).toEqual([
			undefined,
			'Área',
			'Entregas',
			'Acierto total',
			'Antes',
			'Después'
		]);

		const pdf = await buildClientPdf(meta, report);
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
	});
});
