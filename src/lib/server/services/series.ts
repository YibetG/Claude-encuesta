import { asc, eq, sql } from 'drizzle-orm';
import type { DB, Executor } from '../db/client';
import { assessments, participants, questionOptions, questions } from '../db/schema';
import { audit } from '../security/audit';
import { generateSlug, type Assessment } from './assessments';

// Series de mediciones: el mismo assessment aplicado varias veces (antes y después de una
// formación, seguimiento…) para compararlas. Cada medición es un assessment normal, con su
// propio link, contraseña, fechas y participantes; lo que comparten son las preguntas.
// Para que la comparación sea exacta, las preguntas de una serie no se pueden modificar y se
// emparejan por su posición.

const SUFFIX = / · Medición \d+$/;
const DAY = 24 * 3600 * 1000;

/** Mediciones de la serie del assessment, en orden. Si no está en una serie: solo él. */
export function seriesMembers(db: Executor, a: Pick<Assessment, 'id' | 'seriesId'>): Assessment[] {
	if (!a.seriesId) {
		const self = db.select().from(assessments).where(eq(assessments.id, a.id)).get();
		return self ? [self] : [];
	}
	return db
		.select()
		.from(assessments)
		.where(eq(assessments.seriesId, a.seriesId))
		.orderBy(asc(assessments.seriesOrder), asc(assessments.createdAt))
		.all();
}

/** ¿Las preguntas están compartidas con otra medición? (entonces no se pueden modificar) */
export function inSharedSeries(db: Executor, assessmentId: string): boolean {
	const row = db
		.select({ seriesId: assessments.seriesId })
		.from(assessments)
		.where(eq(assessments.id, assessmentId))
		.get();
	if (!row?.seriesId) return false;
	const n =
		db
			.select({ n: sql<number>`count(*)` })
			.from(assessments)
			.where(eq(assessments.seriesId, row.seriesId))
			.get()?.n ?? 0;
	return n > 1;
}

/**
 * Crea la siguiente medición de la serie a partir de `sourceId`: copia las preguntas (con la
 * opción esperada), el cliente, los textos, la plantilla de invitación y los participantes
 * (sin marcarlos como invitados). Queda en borrador, sin contraseña, con fechas propuestas.
 */
export function createNextMeasurement(db: DB, sourceId: string, adminId: string, ip?: string) {
	return db.transaction((tx) => {
		const source = tx.select().from(assessments).where(eq(assessments.id, sourceId)).get();
		if (!source) return undefined;

		const seriesId = source.seriesId ?? source.id;
		if (!source.seriesId) {
			tx.update(assessments)
				.set({ seriesId, seriesOrder: 1, updatedAt: new Date() })
				.where(eq(assessments.id, source.id))
				.run();
		}
		const order =
			(tx
				.select({ max: sql<number>`max(${assessments.seriesOrder})` })
				.from(assessments)
				.where(eq(assessments.seriesId, seriesId))
				.get()?.max ?? 1) + 1;

		// Fechas propuestas: empieza un día después de que cierre la medición de origen (o de hoy)
		// y dura lo mismo. Se ajustan en la pestaña General.
		const duration = Math.max(source.endsAt.getTime() - source.startsAt.getTime(), DAY);
		const startsAt = new Date(Math.max(source.endsAt.getTime(), Date.now()) + DAY);
		const endsAt = new Date(startsAt.getTime() + duration);

		const copy = tx
			.insert(assessments)
			.values({
				slug: generateSlug(),
				title: `${source.title.replace(SUFFIX, '')} · Medición ${order}`.slice(0, 200),
				clientId: source.clientId,
				description: source.description,
				instructions: source.instructions,
				startsAt,
				endsAt,
				timezone: source.timezone,
				accessMode: source.accessMode,
				openMaxChars: source.openMaxChars,
				inviteSubject: source.inviteSubject,
				inviteBody: source.inviteBody,
				status: 'borrador',
				seriesId,
				seriesOrder: order,
				createdById: adminId
			})
			.returning()
			.get();

		const qs = tx
			.select()
			.from(questions)
			.where(eq(questions.assessmentId, source.id))
			.orderBy(asc(questions.position))
			.all();
		for (const q of qs) {
			const { id } = tx
				.insert(questions)
				.values({
					assessmentId: copy.id,
					type: q.type,
					prompt: q.prompt,
					required: q.required,
					position: q.position
				})
				.returning({ id: questions.id })
				.get();
			const opts = tx
				.select()
				.from(questionOptions)
				.where(eq(questionOptions.questionId, q.id))
				.all();
			if (opts.length) {
				tx.insert(questionOptions)
					.values(
						opts.map((o) => ({
							questionId: id,
							text: o.text,
							isCorrect: o.isCorrect,
							position: o.position
						}))
					)
					.run();
			}
		}

		const people = tx
			.select()
			.from(participants)
			.where(eq(participants.assessmentId, source.id))
			.all();
		if (people.length) {
			tx.insert(participants)
				.values(
					people.map((p) => ({
						assessmentId: copy.id,
						name: p.name,
						email: p.email,
						area: p.area,
						cargo: p.cargo,
						extra: p.extra,
						source: p.source
					}))
				)
				.run();
		}

		audit(tx, {
			adminId,
			action: 'assessment.medicion_creada',
			entityType: 'assessment',
			entityId: copy.id,
			metadata: {
				titulo: copy.title,
				medicion: order,
				origen: source.id,
				preguntas: qs.length,
				participantes: people.length
			},
			ip
		});
		return copy;
	});
}
