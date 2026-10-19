import { z } from 'zod';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const MAX_QUESTIONS = 200;

const prompt = z
	.string({ error: 'Escriba el enunciado.' })
	.trim()
	.min(1, 'Escriba el enunciado.')
	.max(2000, 'El enunciado no puede superar 2.000 caracteres.');

const option = z.object({
	text: z
		.string({ error: 'Escriba el texto de la opción.' })
		.trim()
		.min(1, 'Hay una opción vacía.')
		.max(500, 'Una opción no puede superar 500 caracteres.'),
	isCorrect: z.boolean()
});

export const choiceQuestionSchema = z.object({
	type: z.literal('opcion_unica'),
	prompt,
	required: z.boolean(),
	options: z
		.array(option)
		.min(MIN_OPTIONS, `Debe tener al menos ${MIN_OPTIONS} opciones.`)
		.max(MAX_OPTIONS, `Puede tener máximo ${MAX_OPTIONS} opciones.`)
		.refine(
			(opts) => opts.filter((o) => o.isCorrect).length === 1,
			'Marque exactamente una opción correcta.'
		)
		.refine(
			(opts) => new Set(opts.map((o) => o.text.trim().toLowerCase())).size === opts.length,
			'Hay opciones repetidas.'
		)
});

export const openQuestionSchema = z.object({
	type: z.literal('abierta'),
	prompt,
	required: z.boolean()
});

export const questionSchema = z.discriminatedUnion(
	'type',
	[choiceQuestionSchema, openQuestionSchema],
	{
		error: 'Tipo de pregunta no válido.'
	}
);

export const questionListSchema = z
	.array(questionSchema)
	.max(MAX_QUESTIONS, `Máximo ${MAX_QUESTIONS} preguntas por assessment.`);

export type QuestionInput = z.infer<typeof questionSchema>;

/**
 * Mensajes legibles para una lista de preguntas, ej. "Pregunta 3, opción 2: Hay una opción vacía."
 * `rowLabel` permite decir "Fila" en la importación desde Excel.
 */
export function questionIssues(error: z.ZodError, rowLabel = 'Pregunta', rowOffset = 1): string[] {
	const messages = error.issues.map((issue) => {
		const [index, field, optIndex] = issue.path;
		if (typeof index !== 'number') return issue.message;
		let where = `${rowLabel} ${index + rowOffset}`;
		if (field === 'options' && typeof optIndex === 'number') where += `, opción ${optIndex + 1}`;
		return `${where}: ${issue.message}`;
	});
	return [...new Set(messages)];
}
