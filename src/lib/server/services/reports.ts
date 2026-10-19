import { and, eq, isNotNull } from 'drizzle-orm';
import type { DB } from '../db/client';
import { answers, submissions } from '../db/schema';
import { listQuestionsForAdmin } from './questions';
import { listParticipants, type ParticipantRow } from './participants';

// Reporte de un assessment. No hay puntaje por persona: cada pregunta de selección
// tiene una opción "esperada" y se mide qué tan alineadas están las respuestas con ella.
// Solo cuentan las entregas finales (los borradores en progreso no se incluyen).

export type ReportFilters = { area?: string | null; cargo?: string | null };

export type OptionStat = {
	id: string;
	text: string;
	isExpected: boolean;
	count: number;
	/** Proporción (0–1) sobre quienes respondieron la pregunta. */
	rate: number;
};

export type ChoiceStat = {
	id: string;
	number: number;
	prompt: string;
	required: boolean;
	respondents: number;
	omitted: number;
	aligned: number;
	/** Proporción (0–1) que eligió la opción esperada; `null` si nadie respondió. */
	alignmentRate: number | null;
	options: OptionStat[];
};

export type OpenResponse = {
	participantName: string;
	email: string;
	area: string | null;
	cargo: string | null;
	text: string;
};

export type OpenStat = {
	id: string;
	number: number;
	prompt: string;
	required: boolean;
	responses: OpenResponse[];
};

export type Report = {
	filters: ReportFilters;
	summary: {
		invited: number;
		inProgress: number;
		submitted: number;
		/** Entregas / participantes (0–1), `null` sin participantes. */
		participationRate: number | null;
		/** Promedio de la alineación de las preguntas de selección con respuestas. */
		averageAlignment: number | null;
		mostAligned: ChoiceStat[];
		leastAligned: ChoiceStat[];
	};
	choice: ChoiceStat[];
	open: OpenStat[];
	participants: ParticipantRow[];
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function buildReport(db: DB, assessmentId: string, filters: ReportFilters = {}): Report {
	const participants = listParticipants(db, assessmentId).filter(
		(p) =>
			(!filters.area || p.area === filters.area) && (!filters.cargo || p.cargo === filters.cargo)
	);
	const submitted = participants.filter((p) => p.status === 'completado');
	const byId = new Map(submitted.map((p) => [p.id, p]));

	// Respuestas de las entregas finales, limitadas a los participantes del filtro.
	const rows = db
		.select({
			participantId: submissions.participantId,
			questionId: answers.questionId,
			optionId: answers.optionId,
			text: answers.text
		})
		.from(answers)
		.innerJoin(submissions, eq(submissions.id, answers.submissionId))
		.where(and(eq(submissions.assessmentId, assessmentId), isNotNull(submissions.submittedAt)))
		.all()
		.filter((r) => byId.has(r.participantId));

	const questions = listQuestionsForAdmin(db, assessmentId);
	const choice: ChoiceStat[] = [];
	const open: OpenStat[] = [];

	questions.forEach((q, i) => {
		const qRows = rows.filter((r) => r.questionId === q.id);
		if (q.type === 'opcion_unica') {
			const counts = new Map<string, number>();
			for (const r of qRows)
				if (r.optionId) counts.set(r.optionId, (counts.get(r.optionId) ?? 0) + 1);
			const respondents = [...counts.values()].reduce((s, n) => s + n, 0);
			const expected = q.options.find((o) => o.isCorrect);
			const aligned = expected ? (counts.get(expected.id) ?? 0) : 0;
			choice.push({
				id: q.id,
				number: i + 1,
				prompt: q.prompt,
				required: q.required,
				respondents,
				omitted: submitted.length - respondents,
				aligned,
				alignmentRate: ratio(aligned, respondents),
				options: q.options.map((o) => ({
					id: o.id,
					text: o.text,
					isExpected: o.isCorrect,
					count: counts.get(o.id) ?? 0,
					rate: ratio(counts.get(o.id) ?? 0, respondents) ?? 0
				}))
			});
		} else {
			open.push({
				id: q.id,
				number: i + 1,
				prompt: q.prompt,
				required: q.required,
				responses: qRows
					.filter((r) => r.text?.trim())
					.map((r) => {
						const p = byId.get(r.participantId)!;
						return {
							participantName: p.name,
							email: p.email,
							area: p.area,
							cargo: p.cargo,
							text: r.text!
						};
					})
					.sort((a, b) => a.participantName.localeCompare(b.participantName, 'es'))
			});
		}
	});

	const answered = choice.filter((c) => c.alignmentRate !== null);
	const sorted = [...answered].sort(
		(a, b) => b.alignmentRate! - a.alignmentRate! || a.number - b.number
	);
	const top = Math.min(3, Math.floor(sorted.length / 2) || sorted.length);

	return {
		filters,
		summary: {
			invited: participants.length,
			inProgress: participants.filter((p) => p.status === 'en_progreso').length,
			submitted: submitted.length,
			participationRate: ratio(submitted.length, participants.length),
			averageAlignment: answered.length
				? answered.reduce((s, c) => s + c.alignmentRate!, 0) / answered.length
				: null,
			mostAligned: sorted.slice(0, top),
			leastAligned: sorted.length > 1 ? sorted.slice(-top).reverse() : []
		},
		choice,
		open,
		participants
	};
}
