import type { DB } from '../db/client';
import { listAssessments } from './assessments';
import { buildReport, participantScores } from './reports';
import type { Assessment } from './assessments';

// Informe general de un cliente: consolida todos sus assessments (salvo borradores).
// Como cada assessment puede tener preguntas distintas, se compara assessment por assessment
// (y por área y cargo), no pregunta por pregunta. Solo cuentan las entregas finales.

export type ClientAssessmentRow = {
	id: string;
	title: string;
	status: Assessment['status'];
	startsAt: Date;
	endsAt: Date;
	timezone: string;
	participants: number;
	submitted: number;
	participationRate: number | null;
	/** Promedio de la alineación de sus preguntas de selección. */
	averageAlignment: number | null;
	/** Promedio del porcentaje de acierto de las personas que entregaron. */
	averageScore: number | null;
};

export type GroupRow = {
	name: string;
	/** Entregas de personas de este grupo (una persona en dos assessments cuenta dos veces). */
	submissions: number;
	averageScore: number | null;
	/** Acierto promedio del grupo en cada assessment (id → promedio), para ver la evolución. */
	byAssessment: Record<string, number | null>;
};

export type ClientReport = {
	summary: {
		assessments: number;
		withSubmissions: number;
		/** Personas distintas (por correo) invitadas o registradas en algún assessment. */
		people: number;
		participants: number;
		submitted: number;
		participationRate: number | null;
		averageAlignment: number | null;
		averageScore: number | null;
	};
	assessments: ClientAssessmentRow[];
	byArea: GroupRow[];
	byCargo: GroupRow[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const SIN_DATO = 'Sin dato';

export function buildClientReport(db: DB, clientId: string): ClientReport {
	const list = listAssessments(db, { includeArchived: true, clientId })
		.filter((a) => a.status !== 'borrador')
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

	const rows: ClientAssessmentRow[] = [];
	const emails = new Set<string>();
	const allScores: number[] = [];
	// grupo → assessment → puntajes de las personas que entregaron
	const areas = new Map<string, Map<string, number[]>>();
	const cargos = new Map<string, Map<string, number[]>>();
	const add = (groups: typeof areas, key: string, assessmentId: string, score: number) => {
		const g = groups.get(key) ?? new Map<string, number[]>();
		groups.set(key, g);
		g.set(assessmentId, [...(g.get(assessmentId) ?? []), score]);
	};

	for (const a of list) {
		const report = buildReport(db, a.id);
		const scores = participantScores(db, a.id);
		const own: number[] = [];
		for (const p of report.participants) {
			emails.add(p.email.toLowerCase());
			const rate = scores.get(p.id)?.rate;
			if (p.status !== 'completado' || rate == null) continue;
			own.push(rate);
			allScores.push(rate);
			add(areas, p.area?.trim() || SIN_DATO, a.id, rate);
			add(cargos, p.cargo?.trim() || SIN_DATO, a.id, rate);
		}
		rows.push({
			id: a.id,
			title: a.title,
			status: a.status,
			startsAt: a.startsAt,
			endsAt: a.endsAt,
			timezone: a.timezone,
			participants: report.summary.invited,
			submitted: report.summary.submitted,
			participationRate: report.summary.participationRate,
			averageAlignment: report.summary.averageAlignment,
			averageScore: mean(own)
		});
	}

	const groupRows = (groups: typeof areas): GroupRow[] =>
		[...groups]
			.map(([name, byA]) => {
				const all = [...byA.values()].flat();
				return {
					name,
					submissions: all.length,
					averageScore: mean(all),
					byAssessment: Object.fromEntries(rows.map((r) => [r.id, mean(byA.get(r.id) ?? [])]))
				};
			})
			// "Sin dato" al final; el resto por cantidad de entregas.
			.sort(
				(x, y) =>
					Number(x.name === SIN_DATO) - Number(y.name === SIN_DATO) ||
					y.submissions - x.submissions ||
					x.name.localeCompare(y.name, 'es')
			);

	const participants = rows.reduce((s, r) => s + r.participants, 0);
	const submitted = rows.reduce((s, r) => s + r.submitted, 0);
	const withSubmissions = rows.filter((r) => r.submitted > 0);
	return {
		summary: {
			assessments: rows.length,
			withSubmissions: withSubmissions.length,
			people: emails.size,
			participants,
			submitted,
			participationRate: participants ? submitted / participants : null,
			averageAlignment: mean(
				withSubmissions.map((r) => r.averageAlignment).filter((x): x is number => x !== null)
			),
			averageScore: mean(allScores)
		},
		assessments: rows,
		byArea: groupRows(areas),
		byCargo: groupRows(cargos)
	};
}
