import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { DB, Executor } from '../db/client';
import { answers, questionOptions, questions, submissions } from '../db/schema';
import { invalidateParticipantSessions } from '../auth/participant-session';
import type { ParticipantContext } from './access';

/** Pregunta tal como la ve el participante: SIN la opción correcta. */
export type ParticipantQuestion = {
	id: string;
	type: 'opcion_unica' | 'abierta';
	prompt: string;
	required: boolean;
	options: { id: string; text: string }[];
};

/**
 * Preguntas para el navegador del participante. Se seleccionan columnas explícitas:
 * `isCorrect` nunca se lee aquí, así que no puede filtrarse por error.
 */
export function listQuestionsForParticipant(
	db: Executor,
	assessmentId: string
): ParticipantQuestion[] {
	const qs = db
		.select({
			id: questions.id,
			type: questions.type,
			prompt: questions.prompt,
			required: questions.required
		})
		.from(questions)
		.where(eq(questions.assessmentId, assessmentId))
		.orderBy(asc(questions.position))
		.all();
	if (!qs.length) return [];

	const opts = db
		.select({
			id: questionOptions.id,
			questionId: questionOptions.questionId,
			text: questionOptions.text
		})
		.from(questionOptions)
		.where(
			inArray(
				questionOptions.questionId,
				qs.map((q) => q.id)
			)
		)
		.orderBy(asc(questionOptions.position))
		.all();

	return qs.map((q) => ({
		...q,
		options: opts.filter((o) => o.questionId === q.id).map(({ id, text }) => ({ id, text }))
	}));
}

export type SavedAnswers = Record<string, { optionId: string | null; text: string | null }>;

export function getAnswers(db: Executor, submissionId: string): SavedAnswers {
	const rows = db
		.select({ questionId: answers.questionId, optionId: answers.optionId, text: answers.text })
		.from(answers)
		.where(eq(answers.submissionId, submissionId))
		.all();
	return Object.fromEntries(
		rows.map((r) => [r.questionId, { optionId: r.optionId, text: r.text }])
	);
}

/** Campos del formulario de respuestas: `q_<idPregunta>` → valor. */
export function readAnswerFields(form: FormData): { questionId: string; value: string }[] {
	const out: { questionId: string; value: string }[] = [];
	for (const [key, value] of form.entries()) {
		if (key.startsWith('q_') && typeof value === 'string') {
			out.push({ questionId: key.slice(2), value });
		}
	}
	return out;
}

export class AlreadySubmittedError extends Error {
	constructor() {
		super('Este assessment ya fue entregado.');
	}
}

/**
 * Guarda (o borra, si viene vacío) las respuestas enviadas. Valida que cada pregunta
 * sea de este assessment, que la opción pertenezca a la pregunta y el largo del texto.
 */
export function saveAnswers(
	db: DB,
	ctx: ParticipantContext,
	entries: { questionId: string; value: string }[],
	now = new Date()
): { ok: true; saved: number } | { ok: false; errors: string[] } {
	const qs = listQuestionsForParticipant(db, ctx.assessment.id);
	const byId = new Map(qs.map((q, i) => [q.id, { ...q, number: i + 1 }]));
	const max = ctx.assessment.openMaxChars;
	const errors: string[] = [];
	const ops: { questionId: string; optionId: string | null; text: string | null }[] = [];

	for (const { questionId, value } of entries) {
		const q = byId.get(questionId);
		if (!q) {
			errors.push('Se recibió una respuesta para una pregunta que no existe.');
			continue;
		}
		if (q.type === 'opcion_unica') {
			if (value === '') ops.push({ questionId, optionId: null, text: null });
			else if (q.options.some((o) => o.id === value))
				ops.push({ questionId, optionId: value, text: null });
			else errors.push(`Pregunta ${q.number}: opción no válida.`);
		} else {
			const text = value.replace(/\r\n/g, '\n');
			if (text.length > max) {
				errors.push(
					`Pregunta ${q.number}: supera el máximo de ${max.toLocaleString('es-CO')} caracteres.`
				);
			} else {
				ops.push({ questionId, optionId: null, text: text.trim() === '' ? null : text });
			}
		}
	}
	if (errors.length) return { ok: false, errors: [...new Set(errors)] };

	db.transaction((tx) => {
		// Se vuelve a verificar dentro de la transacción: si entregó entre medio, no se guarda.
		const sub = tx
			.select({ submittedAt: submissions.submittedAt })
			.from(submissions)
			.where(eq(submissions.id, ctx.submission.id))
			.get();
		if (!sub || sub.submittedAt) throw new AlreadySubmittedError();

		for (const op of ops) {
			if (op.optionId === null && op.text === null) {
				tx.delete(answers)
					.where(
						and(eq(answers.submissionId, ctx.submission.id), eq(answers.questionId, op.questionId))
					)
					.run();
			} else {
				tx.insert(answers)
					.values({ submissionId: ctx.submission.id, ...op, updatedAt: now })
					.onConflictDoUpdate({
						target: [answers.submissionId, answers.questionId],
						set: { optionId: op.optionId, text: op.text, updatedAt: now }
					})
					.run();
			}
		}
		tx.update(submissions)
			.set({ updatedAt: now })
			.where(eq(submissions.id, ctx.submission.id))
			.run();
	});

	return { ok: true, saved: ops.length };
}

/**
 * Entrega final. Exige las preguntas obligatorias y marca la entrega una sola vez
 * (la condición `submitted_at IS NULL` evita una doble entrega simultánea).
 */
export function submitAnswers(
	db: DB,
	ctx: ParticipantContext,
	now = new Date()
): { ok: true } | { ok: false; missing: number[] } {
	const result = db.transaction((tx) => {
		const qs = listQuestionsForParticipant(tx, ctx.assessment.id);
		const saved = getAnswers(tx, ctx.submission.id);
		const missing = qs
			.map((q, i) => ({ q, n: i + 1 }))
			.filter(({ q }) => q.required && !saved[q.id]?.optionId && !saved[q.id]?.text?.trim())
			.map(({ n }) => n);
		if (missing.length) return { ok: false as const, missing };

		const updated = tx
			.update(submissions)
			.set({ submittedAt: now, updatedAt: now })
			.where(and(eq(submissions.id, ctx.submission.id), isNull(submissions.submittedAt)))
			.run();
		if (updated.changes === 0) throw new AlreadySubmittedError();
		return { ok: true as const };
	});

	// Tras entregar, la sesión ya no sirve para nada: se cierra.
	if (result.ok) invalidateParticipantSessions(db, ctx.participant.id);
	return result;
}
