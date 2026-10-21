import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestDb } from '../db/test-db';
import { adminUsers, aiAnalyses, answers, submissions } from '../db/schema';
import { assessmentFormSchema } from '../../schemas/assessment';
import { participantSchema } from '../../schemas/participant';
import { createAssessment, getAssessment } from '../services/assessments';
import { listQuestionsForAdmin, replaceQuestions } from '../services/questions';
import { listParticipants, upsertParticipants } from '../services/participants';
import { buildReport } from '../services/reports';
import { latestAnalyses } from '../services/ai-store';
import { exportFileName, exportMeta } from './common';
import { buildExcel, safeText } from './excel';
import { buildPdf, buildPdfDefinition } from './pdf';
import type { AiAnalysis } from '../../ai-analysis';

let db: ReturnType<typeof createTestDb>;
let assessmentId: string;
let openId: string;

const analysis: AiAnalysis = {
	summary: 'Las personas valoran la capacitación.',
	themes: [
		{ name: 'Capacitación', description: 'Piden más cursos.', frequency: 'alta', approxCount: 2 }
	],
	highlights: ['Buena disposición'],
	concerns: ['Poco tiempo'],
	quotes: ['Necesitamos más práctica']
};

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
			title: 'Seguridad de la Información',
			description: 'Evaluación anual',
			instructions: '',
			timezone: 'America/Bogota',
			startsAt: '2026-11-01T08:00',
			endsAt: '2026-11-15T18:00',
			accessMode: 'invitados',
			openMaxChars: '8000'
		}),
		adminId
	).id;
	replaceQuestions(
		db,
		assessmentId,
		[
			{
				type: 'opcion_unica',
				prompt: '¿Qué es confidencialidad?',
				required: true,
				options: [
					{ text: 'Acceso de autorizados', isCorrect: true },
					{ text: 'Todo público', isCorrect: false }
				]
			},
			{ type: 'abierta', prompt: '¿Qué mejoraría?', required: true }
		],
		adminId
	);
	upsertParticipants(
		db,
		assessmentId,
		[
			participantSchema.parse({ name: 'Ana', email: 'ana@x.co', area: 'TI' }),
			// Nombre que parece fórmula: no debe ejecutarse en Excel.
			participantSchema.parse({ name: '=HYPERLINK("http://x")', email: 'luis@x.co', area: 'TI' })
		],
		adminId
	);
	const qs = listQuestionsForAdmin(db, assessmentId);
	openId = qs[1].id;
	for (const p of listParticipants(db, assessmentId)) {
		const s = db
			.insert(submissions)
			.values({
				participantId: p.id,
				assessmentId,
				submittedAt: new Date('2026-11-05T15:30:00Z')
			})
			.returning()
			.get();
		db.insert(answers)
			.values([
				{ submissionId: s.id, questionId: qs[0].id, optionId: qs[0].options[0].id },
				{ submissionId: s.id, questionId: qs[1].id, text: `Respuesta de ${p.email}` }
			])
			.run();
	}
	db.insert(aiAnalyses)
		.values({
			assessmentId,
			questionId: openId,
			scope: 'pregunta',
			model: 'claude-opus-5-5',
			result: analysis,
			inputHash: 'x',
			responseCount: 2
		})
		.run();
});

const meta = () =>
	exportMeta(db, getAssessment(db, assessmentId)!, {}, new Date('2026-11-06T12:00:00Z'));

describe('exportación a Excel', () => {
	it('genera las cuatro hojas con los datos del reporte', async () => {
		const buffer = await buildExcel(meta(), buildReport(db, assessmentId));
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(buffer);
		expect(wb.worksheets.map((w) => w.name)).toEqual([
			'Resumen',
			'Por pregunta',
			'Por participante',
			'Respuestas abiertas'
		]);

		const resumen = wb.getWorksheet('Resumen')!;
		expect(resumen.getCell('A1').value).toBe('Seguridad de la Información');
		const tasa = resumen.getColumn(1).values.indexOf('Tasa de participación');
		expect(resumen.getRow(tasa).getCell(2).value).toBe(1);
		expect(resumen.getRow(tasa).getCell(2).numFmt).toBe('0%');

		const porPregunta = wb.getWorksheet('Por pregunta')!;
		// `values` de ExcelJS empieza en el índice 1 (columna A).
		expect((porPregunta.getRow(2).values as unknown[]).slice(1)).toEqual([
			1,
			'¿Qué es confidencialidad?',
			'Acceso de autorizados',
			'Sí',
			2,
			1
		]);

		const porParticipante = wb.getWorksheet('Por participante')!;
		expect(porParticipante.getRow(1).getCell(8).value).toBe('P1');
		const filas = [2, 3].map((r) => porParticipante.getRow(r));
		expect(filas.map((r) => r.getCell(1).value)).toContain(`'=HYPERLINK("http://x")`);
		expect(filas[0].getCell(8).value).toBe('Acceso de autorizados');
		// La fecha de entrega se muestra en hora de Bogotá (15:30 UTC = 10:30).
		expect((filas[0].getCell(7).value as Date).toISOString()).toBe('2026-11-05T10:30:00.000Z');

		const abiertas = wb.getWorksheet('Respuestas abiertas')!;
		expect(abiertas.rowCount).toBe(3);
		expect(abiertas.getRow(2).getCell(7).value).toMatch(/^Respuesta de /);
	});

	it('neutraliza textos que Excel interpretaría como fórmula', () => {
		expect(safeText('=1+1')).toBe("'=1+1");
		expect(safeText('+57 300')).toBe("'+57 300");
		expect(safeText('Normal')).toBe('Normal');
		expect(safeText(null)).toBe('');
	});

	it('arma un nombre de archivo seguro', () => {
		expect(
			exportFileName('Seguridad de la Información / 2026', 'pdf', new Date('2026-11-06T12:00:00Z'))
		).toBe('informe-seguridad-de-la-informacion-2026-2026-11-06.pdf');
	});
});

describe('exportación a PDF', { timeout: 30_000 }, () => {
	it('genera un PDF válido', async () => {
		const pdf = await buildPdf(
			meta(),
			buildReport(db, assessmentId),
			latestAnalyses(db, assessmentId)
		);
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
		expect(pdf.length).toBeGreaterThan(5000);
		// Para revisar el diseño a mano: SAVE_PDF=1 npx vitest --run src/lib/server/export
		if (process.env.SAVE_PDF) writeFileSync('test-results/informe-con-ia.pdf', pdf);
	});

	it('incluye portada, resumen, preguntas y el análisis con IA guardado', () => {
		const def = buildPdfDefinition(
			meta(),
			buildReport(db, assessmentId),
			latestAnalyses(db, assessmentId)
		);
		const text = JSON.stringify(def.content);
		for (const expected of [
			'Informe de resultados',
			'Seguridad de la Información',
			'Resumen general',
			'Resultados por pregunta',
			'(esperada)',
			'Las personas valoran la capacitación.',
			'Capacitación',
			'Necesitamos más práctica',
			'claude-opus-5-5'
		]) {
			expect(text).toContain(expected);
		}
		// El PDF no incluye nombres ni correos de quienes respondieron.
		expect(text).not.toContain('ana@x.co');
	});

	it('indica cuando una pregunta abierta aún no tiene análisis', () => {
		const def = buildPdfDefinition(meta(), buildReport(db, assessmentId), new Map());
		expect(JSON.stringify(def.content)).toContain('Aún no se ha generado el análisis con IA');
	});
});
