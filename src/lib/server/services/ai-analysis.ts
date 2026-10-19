import { createHash } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { DB } from '../db/client';
import { aiAnalyses, answers, participants, submissions } from '../db/schema';
import { audit } from '../security/audit';
import { getAssessment } from './assessments';
import { listQuestionsForAdmin } from './questions';
import { latestAnalyses } from './ai-store';
import { chunkResponses, createAnonymizer } from '../ai/anonymize';
import { AiError, type Analyzer } from '../ai/client';
import { consolidationPrompt, globalPrompt, questionPrompt } from '../ai/prompts';
import type { AiAnalysis, StoredAnalysis } from '../../ai-analysis';

// Análisis con IA de las respuestas abiertas (solo entregas finales, sin filtros).
// - Las respuestas se anonimizan antes de enviarlas.
// - Si el texto es mucho, se procesa en bloques y luego se consolida.
// - El resultado se guarda con su modelo y fecha; si las respuestas no cambiaron,
//   se reutiliza el último análisis en vez de volver a llamar a la IA (salvo "Regenerar").

/** Tamaño máximo (caracteres) de respuestas por llamada (~25 mil tokens). */
export const CHUNK_CHARS = 100_000;
/** Bloques que se procesan en paralelo. */
const PARALLEL = 3;

export class AiBusyError extends AiError {
	constructor() {
		super('Ya hay un análisis en curso para esta pregunta. Espere a que termine.');
	}
}

// Evita lanzar dos veces el mismo análisis a la vez (doble clic, dos pestañas).
const running = new Set<string>();

type OpenQuestionData = { id: string; number: number; prompt: string; texts: string[] };

/** Respuestas abiertas entregadas, por pregunta, y la lista de nombres para anonimizar. */
function collect(db: DB, assessmentId: string) {
	const questions = listQuestionsForAdmin(db, assessmentId);
	const rows = db
		.select({ questionId: answers.questionId, text: answers.text })
		.from(answers)
		.innerJoin(submissions, eq(submissions.id, answers.submissionId))
		.where(
			and(
				eq(submissions.assessmentId, assessmentId),
				isNotNull(submissions.submittedAt),
				isNotNull(answers.text)
			)
		)
		.all();
	const names = db
		.select({ name: participants.name })
		.from(participants)
		.where(eq(participants.assessmentId, assessmentId))
		.all()
		.map((p) => p.name);

	const anonymize = createAnonymizer(names);
	const open: OpenQuestionData[] = [];
	questions.forEach((q, i) => {
		if (q.type !== 'abierta') return;
		open.push({
			id: q.id,
			number: i + 1,
			prompt: q.prompt,
			// Orden estable para que la huella no dependa del orden de la base.
			texts: rows
				.filter((r) => r.questionId === q.id && r.text?.trim())
				.map((r) => anonymize(r.text!.trim()))
				.sort()
		});
	});
	return open;
}

function hash(...parts: string[]): string {
	const h = createHash('sha256');
	for (const p of parts) h.update(p).update('\u0000');
	return h.digest('hex');
}

/** Ejecuta `fn` sobre los elementos con un máximo de `limit` llamadas simultáneas. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>) {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i], i);
			}
		})
	);
	return out;
}

/** Analiza una pregunta: una llamada, o bloques + consolidación si el texto es largo. */
async function runQuestion(analyzer: Analyzer, title: string, q: OpenQuestionData) {
	const chunks = chunkResponses(q.texts, CHUNK_CHARS);
	if (chunks.length === 1) {
		return {
			analysis: await analyzer.analyze(
				questionPrompt({ assessmentTitle: title, question: q.prompt, responses: q.texts })
			),
			calls: 1
		};
	}
	const partials = await mapLimit(chunks, PARALLEL, (responses, i) =>
		analyzer.analyze(
			questionPrompt({
				assessmentTitle: title,
				question: q.prompt,
				responses,
				block: { index: i + 1, total: chunks.length, totalResponses: q.texts.length }
			})
		)
	);
	const analysis = await analyzer.analyze(
		consolidationPrompt({
			assessmentTitle: title,
			scope: `pregunta "${q.prompt}"`,
			totalResponses: q.texts.length,
			partials: partials.map((p, i) => ({ label: `bloque ${i + 1}`, analysis: p }))
		})
	);
	return { analysis, calls: chunks.length + 1 };
}

function store(
	db: DB,
	opts: {
		assessmentId: string;
		questionId: string | null;
		model: string;
		analysis: AiAnalysis;
		inputHash: string;
		responseCount: number;
		adminId: string;
	}
): StoredAnalysis {
	const row = db
		.insert(aiAnalyses)
		.values({
			assessmentId: opts.assessmentId,
			questionId: opts.questionId,
			scope: opts.questionId ? 'pregunta' : 'global',
			model: opts.model,
			result: opts.analysis,
			inputHash: opts.inputHash,
			responseCount: opts.responseCount,
			createdById: opts.adminId
		})
		.returning()
		.get();
	return {
		id: row.id,
		questionId: row.questionId,
		model: row.model,
		createdAt: row.createdAt,
		responseCount: row.responseCount,
		inputHash: row.inputHash,
		result: opts.analysis
	};
}

async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
	if (running.has(key)) throw new AiBusyError();
	running.add(key);
	try {
		return await fn();
	} finally {
		running.delete(key);
	}
}

export type AnalysisOutcome = { analysis: StoredAnalysis; cached: boolean };

/** Analiza una pregunta abierta. Con `force` vuelve a llamar a la IA aunque nada haya cambiado. */
export async function analyzeQuestion(
	db: DB,
	analyzer: Analyzer,
	opts: { assessmentId: string; questionId: string; adminId: string; force?: boolean; ip?: string }
): Promise<AnalysisOutcome> {
	const a = getAssessment(db, opts.assessmentId);
	if (!a) throw new AiError('El assessment no existe.');
	const q = collect(db, a.id).find((x) => x.id === opts.questionId);
	if (!q) throw new AiError('La pregunta no existe o no es de respuesta abierta.');
	if (!q.texts.length) throw new AiError('Esta pregunta todavía no tiene respuestas entregadas.');

	const inputHash = hash(analyzer.model, 'pregunta', q.prompt, ...q.texts);
	const latest = latestAnalyses(db, a.id).get(q.id);
	if (!opts.force && latest?.inputHash === inputHash) return { analysis: latest, cached: true };

	return exclusive(`${a.id}:${q.id}`, async () => {
		const { analysis, calls } = await runQuestion(analyzer, a.title, q);
		const stored = store(db, {
			assessmentId: a.id,
			questionId: q.id,
			model: analyzer.model,
			analysis,
			inputHash,
			responseCount: q.texts.length,
			adminId: opts.adminId
		});
		audit(db, {
			adminId: opts.adminId,
			action: 'ia.analisis',
			entityType: 'assessment',
			entityId: a.id,
			metadata: {
				pregunta: q.number,
				respuestas: q.texts.length,
				modelo: analyzer.model,
				llamadas: calls
			},
			ip: opts.ip
		});
		return { analysis: stored, cached: false };
	});
}

/**
 * Análisis global de todas las preguntas abiertas. Si todo el texto cabe en una llamada
 * se envía completo; si no, se consolida a partir del análisis de cada pregunta.
 */
export async function analyzeGlobal(
	db: DB,
	analyzer: Analyzer,
	opts: { assessmentId: string; adminId: string; force?: boolean; ip?: string }
): Promise<AnalysisOutcome> {
	const a = getAssessment(db, opts.assessmentId);
	if (!a) throw new AiError('El assessment no existe.');
	const questions = collect(db, a.id).filter((q) => q.texts.length);
	if (!questions.length) throw new AiError('Todavía no hay respuestas abiertas entregadas.');

	const total = questions.reduce((s, q) => s + q.texts.length, 0);
	const inputHash = hash(
		analyzer.model,
		'global',
		...questions.flatMap((q) => [q.prompt, ...q.texts])
	);
	const latest = latestAnalyses(db, a.id).get('global');
	if (!opts.force && latest?.inputHash === inputHash) return { analysis: latest, cached: true };

	return exclusive(`${a.id}:global`, async () => {
		const chars = questions.reduce((s, q) => s + q.texts.reduce((t, x) => t + x.length, 0), 0);
		let analysis: AiAnalysis;
		let calls = 1;
		if (chars <= CHUNK_CHARS) {
			analysis = await analyzer.analyze(
				globalPrompt({
					assessmentTitle: a.title,
					questions: questions.map((q) => ({ question: q.prompt, responses: q.texts }))
				})
			);
		} else {
			// Reutiliza (o genera) el análisis de cada pregunta y los consolida.
			const partials: { label: string; analysis: AiAnalysis }[] = [];
			for (const q of questions) {
				const r = await analyzeQuestion(db, analyzer, {
					assessmentId: a.id,
					questionId: q.id,
					adminId: opts.adminId,
					ip: opts.ip
				});
				if (!r.cached) calls++;
				partials.push({ label: `pregunta ${q.number}: ${q.prompt}`, analysis: r.analysis.result });
			}
			analysis = await analyzer.analyze(
				consolidationPrompt({
					assessmentTitle: a.title,
					scope: 'análisis global de todas las preguntas abiertas',
					totalResponses: total,
					partials
				})
			);
		}

		const stored = store(db, {
			assessmentId: a.id,
			questionId: null,
			model: analyzer.model,
			analysis,
			inputHash,
			responseCount: total,
			adminId: opts.adminId
		});
		audit(db, {
			adminId: opts.adminId,
			action: 'ia.analisis',
			entityType: 'assessment',
			entityId: a.id,
			metadata: { alcance: 'global', respuestas: total, modelo: analyzer.model, llamadas: calls },
			ip: opts.ip
		});
		return { analysis: stored, cached: false };
	});
}
