import { and, eq, isNotNull } from 'drizzle-orm';
import type { DB } from '../db/client';
import { answers, submissions } from '../db/schema';
import type { Assessment } from './assessments';
import { listParticipants } from './participants';
import { listQuestionsForAdmin } from './questions';
import { participantScores } from './reports';
import { seriesMembers } from './series';

// Comparativo entre las mediciones de una serie. Las preguntas se emparejan por posición
// (en una serie no se pueden modificar) y las personas por su correo.
// - "pareado": solo quienes entregaron TODAS las mediciones comparadas (comparación justa).
// - "todos": cada medición con todas sus entregas.

export type ComparisonMode = 'pareado' | 'todos';

export type MeasurementInfo = {
	id: string;
	title: string;
	order: number;
	status: Assessment['status'];
	startsAt: Date;
	endsAt: Date;
	timezone: string;
	/** Entregas incluidas según el modo. */
	submitted: number;
	averageScore: number | null;
	averageAlignment: number | null;
};

export type Transitions = {
	/** Pasó de una opción no esperada a la esperada (primera → última). */
	improved: number;
	keptRight: number;
	/** Pasó de la esperada a otra. */
	worsened: number;
	keptWrong: number;
};

export type ChoiceComparison = {
	position: number;
	prompt: string;
	rates: (number | null)[];
	respondents: number[];
	delta: number | null;
	/** Solo en modo pareado y con al menos dos mediciones. */
	transitions: Transitions | null;
	options: { text: string; isExpected: boolean; rates: (number | null)[] }[];
};

export type OpenComparison = {
	position: number;
	prompt: string;
	responses: { email: string; name: string; texts: (string | null)[] }[];
};

export type PersonComparison = {
	email: string;
	name: string;
	area: string | null;
	cargo: string | null;
	scores: (number | null)[];
	delta: number | null;
};

export type GroupComparison = {
	name: string;
	counts: number[];
	scores: (number | null)[];
	delta: number | null;
};

export type Comparison = {
	mode: ComparisonMode;
	/** Todas las mediciones de la serie (para elegir cuáles comparar). */
	series: {
		id: string;
		title: string;
		order: number;
		status: Assessment['status'];
		submitted: number;
	}[];
	measurements: MeasurementInfo[];
	summary: {
		/** Personas que entregaron todas las mediciones comparadas. */
		paired: number;
		firstScore: number | null;
		lastScore: number | null;
		delta: number | null;
		firstAlignment: number | null;
		lastAlignment: number | null;
		alignmentDelta: number | null;
	};
	choice: ChoiceComparison[];
	open: OpenComparison[];
	people: PersonComparison[];
	byArea: GroupComparison[];
	byCargo: GroupComparison[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
/** Diferencia entre el último y el primer valor con dato. */
function delta(values: (number | null)[]): number | null {
	const known = values.filter((v): v is number => v !== null);
	return known.length >= 2 ? known[known.length - 1] - known[0] : null;
}
const SIN_DATO = 'Sin dato';

type Person = { participantId: string; name: string; area: string | null; cargo: string | null };
type Loaded = {
	a: Assessment;
	people: Map<string, Person>; // email → persona que entregó
	scores: Map<string, number | null>; // email → acierto
	// email → posición de la pregunta → { optionPosition, correct } | texto
	picks: Map<string, Map<number, { option: number; correct: boolean } | { text: string }>>;
	questions: ReturnType<typeof listQuestionsForAdmin>;
};

function load(db: DB, a: Assessment): Loaded {
	const questions = listQuestionsForAdmin(db, a.id);
	const byQuestion = new Map(questions.map((q) => [q.id, q]));
	const submitted = listParticipants(db, a.id).filter((p) => p.status === 'completado');
	const byId = new Map(submitted.map((p) => [p.id, p]));
	const scores = participantScores(db, a.id);

	const people = new Map<string, Person>();
	const scoreByEmail = new Map<string, number | null>();
	for (const p of submitted) {
		people.set(p.email, { participantId: p.id, name: p.name, area: p.area, cargo: p.cargo });
		scoreByEmail.set(p.email, scores.get(p.id)?.rate ?? null);
	}

	const picks: Loaded['picks'] = new Map();
	const rows = db
		.select({
			participantId: submissions.participantId,
			questionId: answers.questionId,
			optionId: answers.optionId,
			text: answers.text
		})
		.from(answers)
		.innerJoin(submissions, eq(submissions.id, answers.submissionId))
		.where(and(eq(submissions.assessmentId, a.id), isNotNull(submissions.submittedAt)))
		.all();
	for (const r of rows) {
		const p = byId.get(r.participantId);
		const q = byQuestion.get(r.questionId);
		if (!p || !q) continue;
		const map = picks.get(p.email) ?? new Map();
		picks.set(p.email, map);
		if (r.optionId) {
			const o = q.options.find((x) => x.id === r.optionId);
			if (o) map.set(q.position, { option: o.position, correct: o.isCorrect });
		} else if (r.text?.trim()) {
			map.set(q.position, { text: r.text });
		}
	}
	return { a, people, scores: scoreByEmail, picks, questions };
}

/**
 * @param selectedIds mediciones a comparar (de la serie); vacío = todas las que no son borrador.
 */
export function buildComparison(
	db: DB,
	assessment: Pick<Assessment, 'id' | 'seriesId'>,
	{ mode = 'pareado', selectedIds = [] }: { mode?: ComparisonMode; selectedIds?: string[] } = {}
): Comparison {
	const members = seriesMembers(db, assessment);
	const all = members.map((a) => load(db, a));
	const series = all.map((l, i) => ({
		id: l.a.id,
		title: l.a.title,
		order: l.a.seriesOrder ?? i + 1,
		status: l.a.status,
		submitted: l.people.size
	}));

	const chosen = selectedIds.length
		? all.filter((l) => selectedIds.includes(l.a.id))
		: all.filter((l) => l.a.status !== 'borrador');
	const ms = chosen.length ? chosen : all.slice(0, 1);

	// Personas incluidas en cada medición según el modo.
	const pairedEmails = [...(ms[0]?.people.keys() ?? [])].filter((e) =>
		ms.every((l) => l.people.has(e))
	);
	const included = ms.map((l) =>
		mode === 'pareado' ? pairedEmails.filter((e) => l.people.has(e)) : [...l.people.keys()]
	);

	const base = ms[0]?.questions ?? [];

	// ---- Preguntas de selección ----
	const choice: ChoiceComparison[] = base
		.filter((q) => q.type === 'opcion_unica')
		.map((q) => {
			const respondents: number[] = [];
			const rates = ms.map((l, i) => {
				const picks = included[i]
					.map((e) => l.picks.get(e)?.get(q.position))
					.filter((p): p is { option: number; correct: boolean } => !!p && 'option' in p);
				respondents.push(picks.length);
				return picks.length ? picks.filter((p) => p.correct).length / picks.length : null;
			});
			const options = q.options.map((o) => ({
				text: o.text,
				isExpected: o.isCorrect,
				rates: ms.map((l, i) => {
					const picks = included[i]
						.map((e) => l.picks.get(e)?.get(q.position))
						.filter((p): p is { option: number; correct: boolean } => !!p && 'option' in p);
					return picks.length
						? picks.filter((p) => p.option === o.position).length / picks.length
						: null;
				})
			}));

			let transitions: Transitions | null = null;
			if (mode === 'pareado' && ms.length >= 2) {
				transitions = { improved: 0, keptRight: 0, worsened: 0, keptWrong: 0 };
				const first = ms[0];
				const last = ms[ms.length - 1];
				for (const e of pairedEmails) {
					const x = first.picks.get(e)?.get(q.position);
					const y = last.picks.get(e)?.get(q.position);
					if (!x || !y || !('option' in x) || !('option' in y)) continue;
					if (!x.correct && y.correct) transitions.improved++;
					else if (x.correct && y.correct) transitions.keptRight++;
					else if (x.correct && !y.correct) transitions.worsened++;
					else transitions.keptWrong++;
				}
			}
			return {
				position: q.position,
				prompt: q.prompt,
				rates,
				respondents,
				delta: delta(rates),
				transitions,
				options
			};
		});

	// ---- Preguntas abiertas: textos lado a lado por persona ----
	const everyone = [...new Set(included.flat())];
	const nameOf = (email: string) => {
		for (let i = ms.length - 1; i >= 0; i--) {
			const p = ms[i].people.get(email);
			if (p) return p;
		}
		return undefined;
	};
	const open: OpenComparison[] = base
		.filter((q) => q.type === 'abierta')
		.map((q) => ({
			position: q.position,
			prompt: q.prompt,
			responses: everyone
				.map((email) => ({
					email,
					name: nameOf(email)?.name ?? email,
					texts: ms.map((l, i) => {
						if (!included[i].includes(email)) return null;
						const p = l.picks.get(email)?.get(q.position);
						return p && 'text' in p ? p.text : null;
					})
				}))
				.filter((r) => r.texts.some((t) => t !== null))
				.sort((x, y) => x.name.localeCompare(y.name, 'es'))
		}));

	// ---- Personas ----
	const people: PersonComparison[] = everyone
		.map((email) => {
			const p = nameOf(email)!;
			const scores = ms.map((l, i) =>
				included[i].includes(email) ? (l.scores.get(email) ?? null) : null
			);
			return { email, name: p.name, area: p.area, cargo: p.cargo, scores, delta: delta(scores) };
		})
		.sort((x, y) => x.name.localeCompare(y.name, 'es'));

	// ---- Por área y cargo ----
	const groupBy = (key: (p: PersonComparison) => string | null): GroupComparison[] => {
		const names = [...new Set(people.map((p) => key(p)?.trim() || SIN_DATO))];
		return names
			.map((name) => {
				const members = people.filter((p) => (key(p)?.trim() || SIN_DATO) === name);
				const per = ms.map((_, i) =>
					members.map((p) => p.scores[i]).filter((s): s is number => s !== null)
				);
				const scores = per.map(mean);
				return { name, counts: per.map((x) => x.length), scores, delta: delta(scores) };
			})
			.sort(
				(x, y) =>
					Number(x.name === SIN_DATO) - Number(y.name === SIN_DATO) ||
					Math.max(...y.counts) - Math.max(...x.counts) ||
					x.name.localeCompare(y.name, 'es')
			);
	};

	const measurements: MeasurementInfo[] = ms.map((l, i) => {
		const scores = included[i].map((e) => l.scores.get(e)).filter((s): s is number => s != null);
		const alignments = choice.map((c) => c.rates[i]).filter((r): r is number => r !== null);
		return {
			id: l.a.id,
			title: l.a.title,
			order: l.a.seriesOrder ?? i + 1,
			status: l.a.status,
			startsAt: l.a.startsAt,
			endsAt: l.a.endsAt,
			timezone: l.a.timezone,
			submitted: included[i].length,
			averageScore: mean(scores),
			averageAlignment: mean(alignments)
		};
	});

	const scoresPer = measurements.map((m) => m.averageScore);
	const alignPer = measurements.map((m) => m.averageAlignment);
	return {
		mode,
		series,
		measurements,
		summary: {
			paired: pairedEmails.length,
			firstScore: scoresPer[0] ?? null,
			lastScore: scoresPer.at(-1) ?? null,
			delta: delta(scoresPer),
			firstAlignment: alignPer[0] ?? null,
			lastAlignment: alignPer.at(-1) ?? null,
			alignmentDelta: delta(alignPer)
		},
		choice,
		open,
		people,
		byArea: groupBy((p) => p.area),
		byCargo: groupBy((p) => p.cargo)
	};
}
