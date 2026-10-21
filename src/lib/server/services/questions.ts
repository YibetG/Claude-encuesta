import { asc, eq, inArray } from 'drizzle-orm';
import type { DB, Executor } from '../db/client';
import { questionOptions, questions } from '../db/schema';
import { audit, type AuditAction } from '../security/audit';
import { hasResponses } from './assessments';
import { inSharedSeries } from './series';
import type { QuestionInput } from '../../schemas/question';

export const LOCKED_BY_RESPONSES =
	'Este assessment ya tiene respuestas: las preguntas no se pueden modificar. Duplíquelo para hacer cambios.';
export const LOCKED_BY_SERIES =
	'Este assessment es parte de una serie de mediciones: todas comparten las mismas preguntas para poder compararlas, así que no se pueden modificar. Duplíquelo para hacer cambios.';

export class QuestionsLockedError extends Error {
	constructor(message = LOCKED_BY_RESPONSES) {
		super(message);
	}
}

/** Motivo por el que las preguntas no se pueden modificar, o `null` si se pueden. */
export function questionsLockReason(db: Executor, assessmentId: string): string | null {
	if (inSharedSeries(db, assessmentId)) return LOCKED_BY_SERIES;
	if (hasResponses(db, assessmentId)) return LOCKED_BY_RESPONSES;
	return null;
}

export type AdminQuestion = {
	id: string;
	type: QuestionInput['type'];
	prompt: string;
	required: boolean;
	position: number;
	options: { id: string; text: string; isCorrect: boolean; position: number }[];
};

/** Preguntas con sus opciones (incluye la correcta: SOLO para el panel de administración). */
export function listQuestionsForAdmin(db: DB, assessmentId: string): AdminQuestion[] {
	const qs = db
		.select()
		.from(questions)
		.where(eq(questions.assessmentId, assessmentId))
		.orderBy(asc(questions.position))
		.all();
	if (qs.length === 0) return [];

	const opts = db
		.select()
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
		id: q.id,
		type: q.type,
		prompt: q.prompt,
		required: q.required,
		position: q.position,
		options: opts
			.filter((o) => o.questionId === q.id)
			.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect, position: o.position }))
	}));
}

/** Convierte las preguntas guardadas al formato de entrada (para agregar al importar). */
export function toQuestionInputs(list: AdminQuestion[]): QuestionInput[] {
	return list.map((q) =>
		q.type === 'opcion_unica'
			? {
					type: 'opcion_unica',
					prompt: q.prompt,
					required: q.required,
					options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect }))
				}
			: { type: 'abierta', prompt: q.prompt, required: q.required }
	);
}

/**
 * Reemplaza todas las preguntas del assessment (en una transacción).
 * Solo se permite mientras nadie haya empezado a responder.
 */
export function replaceQuestions(
	db: DB,
	assessmentId: string,
	list: QuestionInput[],
	adminId: string,
	{ action = 'preguntas.editadas', ip }: { action?: AuditAction; ip?: string } = {}
): void {
	db.transaction((tx) => {
		// Se verifica dentro de la transacción para que no se cuele una respuesta en medio.
		const locked = questionsLockReason(tx, assessmentId);
		if (locked) throw new QuestionsLockedError(locked);

		tx.delete(questions).where(eq(questions.assessmentId, assessmentId)).run();

		list.forEach((q, i) => {
			const { id } = tx
				.insert(questions)
				.values({
					assessmentId,
					type: q.type,
					prompt: q.prompt,
					required: q.required,
					position: i + 1
				})
				.returning({ id: questions.id })
				.get();

			if (q.type === 'opcion_unica') {
				tx.insert(questionOptions)
					.values(
						q.options.map((o, j) => ({
							questionId: id,
							text: o.text,
							isCorrect: o.isCorrect,
							position: j + 1
						}))
					)
					.run();
			}
		});

		audit(tx, {
			adminId,
			action,
			entityType: 'assessment',
			entityId: assessmentId,
			metadata: {
				preguntas: list.length,
				seleccion: list.filter((q) => q.type === 'opcion_unica').length,
				abiertas: list.filter((q) => q.type === 'abierta').length
			},
			ip
		});
	});
}
