import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { DB, Executor } from '../db/client';
import { assessments, clients, questionOptions, questions, submissions } from '../db/schema';
import { hashPassword } from '../auth/password';
import { decryptSecret, encryptSecret } from '../security/secret-box';
import { audit } from '../security/audit';
import type { AssessmentFormInput } from '../../schemas/assessment';

export type Assessment = typeof assessments.$inferSelect;

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin caracteres ambiguos (l, o, 0, 1)
const SLUG_LENGTH = 12;

/** Slug aleatorio para el link público. 32^12 ≈ 10^18 combinaciones: no se puede adivinar. */
export function generateSlug(): string {
	let out = '';
	for (let i = 0; i < SLUG_LENGTH; i++) out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
	return out;
}

export function getAssessment(db: DB, id: string): Assessment | undefined {
	return db.select().from(assessments).where(eq(assessments.id, id)).get();
}

/** Lista para el panel, con conteos de preguntas, participantes y entregas, y su cliente. */
export function listAssessments(
	db: DB,
	{ includeArchived = false, clientId }: { includeArchived?: boolean; clientId?: string } = {}
) {
	return db
		.select({
			id: assessments.id,
			clientId: assessments.clientId,
			clientName: clients.name,
			title: assessments.title,
			status: assessments.status,
			startsAt: assessments.startsAt,
			endsAt: assessments.endsAt,
			timezone: assessments.timezone,
			// Subconsultas correlacionadas con nombres calificados: Drizzle omite el nombre
			// de la tabla en las columnas, y "id" quedaría ambiguo dentro de la subconsulta.
			questionCount: sql<number>`(select count(*) from "questions" q where q."assessment_id" = "assessments"."id")`,
			participantCount: sql<number>`(select count(*) from "participants" p where p."assessment_id" = "assessments"."id")`,
			submittedCount: sql<number>`(select count(*) from "submissions" s where s."assessment_id" = "assessments"."id" and s."submitted_at" is not null)`,
			inProgressCount: sql<number>`(select count(*) from "submissions" s where s."assessment_id" = "assessments"."id" and s."submitted_at" is null)`,
			notInvitedCount: sql<number>`(select count(*) from "participants" p where p."assessment_id" = "assessments"."id" and p."invited_at" is null)`,
			hasPassword: sql<boolean>`"assessments"."access_password_hash" is not null`.mapWith(Boolean),
			slug: assessments.slug,
			logoMime: clients.logoMime,
			logoUpdatedAt: clients.logoUpdatedAt
		})
		.from(assessments)
		.leftJoin(clients, eq(clients.id, assessments.clientId))
		.where(
			and(
				includeArchived ? undefined : ne(assessments.status, 'archivado'),
				clientId ? eq(assessments.clientId, clientId) : undefined
			)
		)
		.orderBy(desc(assessments.createdAt))
		.all();
}

export function createAssessment(db: DB, input: AssessmentFormInput, adminId: string, ip?: string) {
	const created = db
		.insert(assessments)
		.values({ ...input, slug: generateSlug(), createdById: adminId })
		.returning()
		.get();
	audit(db, {
		adminId,
		action: 'assessment.creado',
		entityType: 'assessment',
		entityId: created.id,
		metadata: { titulo: created.title },
		ip
	});
	return created;
}

export function updateAssessment(
	db: DB,
	id: string,
	input: AssessmentFormInput,
	adminId: string,
	ip?: string
) {
	db.update(assessments)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(assessments.id, id))
		.run();
	audit(db, {
		adminId,
		action: 'assessment.editado',
		entityType: 'assessment',
		entityId: id,
		metadata: { titulo: input.title },
		ip
	});
}

/** Define o cambia la contraseña compartida. Las sesiones de participantes activas no se afectan. */
export async function setAccessPassword(
	db: DB,
	id: string,
	password: string,
	adminId: string,
	ip?: string
) {
	const accessPasswordHash = await hashPassword(password);
	db.update(assessments)
		.set({ accessPasswordHash, accessPasswordEnc: encryptSecret(password), updatedAt: new Date() })
		.where(eq(assessments.id, id))
		.run();
	audit(db, {
		adminId,
		action: 'assessment.password_cambiada',
		entityType: 'assessment',
		entityId: id,
		ip
	});
}

/** Contraseña de acceso vigente en texto, o `null` si solo existe el hash (definida antes). */
export function readAccessPassword(a: Pick<Assessment, 'accessPasswordEnc'>): string | null {
	return a.accessPasswordEnc ? decryptSecret(a.accessPasswordEnc) : null;
}

/** Muestra la contraseña al admin y deja constancia en la auditoría. */
export function revealAccessPassword(db: DB, a: Assessment, adminId: string, ip?: string) {
	const password = readAccessPassword(a);
	if (password !== null) {
		audit(db, {
			adminId,
			action: 'assessment.password_vista',
			entityType: 'assessment',
			entityId: a.id,
			ip
		});
	}
	return password;
}

/** ¿Algún participante ya empezó o entregó? Desde ese momento las preguntas quedan bloqueadas. */
export function hasResponses(db: Executor, assessmentId: string): boolean {
	return !!db
		.select({ id: submissions.id })
		.from(submissions)
		.where(eq(submissions.assessmentId, assessmentId))
		.limit(1)
		.get();
}

export function countQuestions(db: DB, assessmentId: string) {
	const rows = db
		.select({ type: questions.type, n: sql<number>`count(*)` })
		.from(questions)
		.where(eq(questions.assessmentId, assessmentId))
		.groupBy(questions.type)
		.all();
	const choice = rows.find((r) => r.type === 'opcion_unica')?.n ?? 0;
	const open = rows.find((r) => r.type === 'abierta')?.n ?? 0;
	return { choice, open, total: choice + open };
}

/** Requisitos para publicar. Lista vacía = se puede publicar. */
export function publishProblems(db: DB, a: Assessment): string[] {
	const problems: string[] = [];
	if (!a.accessPasswordHash) problems.push('Defina la contraseña de acceso.');
	if (countQuestions(db, a.id).total === 0) problems.push('Agregue al menos una pregunta.');
	if (a.endsAt <= a.startsAt)
		problems.push('La fecha de finalización debe ser posterior al inicio.');
	return problems;
}

export function setStatus(
	db: DB,
	a: Assessment,
	status: Assessment['status'],
	adminId: string,
	ip?: string
) {
	db.update(assessments)
		.set({ status, updatedAt: new Date() })
		.where(eq(assessments.id, a.id))
		.run();
	audit(db, {
		adminId,
		action: status === 'archivado' ? 'assessment.archivado' : 'assessment.editado',
		entityType: 'assessment',
		entityId: a.id,
		metadata: { estado: status, anterior: a.status },
		ip
	});
}

/** Cuánto se borraría con el assessment (para la confirmación y la auditoría). */
export function deletionSummary(db: Executor, id: string) {
	return db.get<{ questions: number; participants: number; submitted: number }>(sql`
		select
			(select count(*) from "questions" where "assessment_id" = ${id}) as "questions",
			(select count(*) from "participants" where "assessment_id" = ${id}) as "participants",
			(select count(*) from "submissions"
				where "assessment_id" = ${id} and "submitted_at" is not null) as "submitted"
	`);
}

/**
 * Elimina definitivamente un assessment. Las claves foráneas borran en cascada sus preguntas,
 * opciones, participantes, sesiones, respuestas, análisis de IA y registro de correos.
 * La auditoría se conserva, con el título y los conteos de lo que se borró.
 */
export function deleteAssessment(db: DB, a: Assessment, adminId: string, ip?: string) {
	db.transaction((tx) => {
		const summary = deletionSummary(tx, a.id);
		tx.delete(assessments).where(eq(assessments.id, a.id)).run();
		audit(tx, {
			adminId,
			action: 'assessment.eliminado',
			entityType: 'assessment',
			entityId: a.id,
			metadata: {
				titulo: a.title,
				estado: a.status,
				preguntas: summary.questions,
				participantes: summary.participants,
				entregas: summary.submitted
			},
			ip
		});
	});
}

/**
 * Duplica un assessment con sus preguntas y opciones (no copia participantes,
 * respuestas ni la contraseña de acceso). La copia queda en borrador.
 */
export function duplicateAssessment(db: DB, id: string, adminId: string, ip?: string) {
	return db.transaction((tx) => {
		const original = tx.select().from(assessments).where(eq(assessments.id, id)).get();
		if (!original) return undefined;

		const copy = tx
			.insert(assessments)
			.values({
				slug: generateSlug(),
				title: `Copia de ${original.title}`.slice(0, 200),
				description: original.description,
				instructions: original.instructions,
				startsAt: original.startsAt,
				endsAt: original.endsAt,
				timezone: original.timezone,
				accessMode: original.accessMode,
				openMaxChars: original.openMaxChars,
				inviteSubject: original.inviteSubject,
				inviteBody: original.inviteBody,
				// La copia es del mismo cliente, así que conserva su marca (la contraseña no se copia).
				clientId: original.clientId,
				status: 'borrador',
				duplicatedFromId: original.id,
				createdById: adminId
			})
			.returning()
			.get();

		const qs = tx
			.select()
			.from(questions)
			.where(eq(questions.assessmentId, id))
			.orderBy(asc(questions.position))
			.all();

		for (const q of qs) {
			const newQ = tx
				.insert(questions)
				.values({
					assessmentId: copy.id,
					type: q.type,
					prompt: q.prompt,
					position: q.position,
					required: q.required
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
							questionId: newQ.id,
							text: o.text,
							position: o.position,
							isCorrect: o.isCorrect
						}))
					)
					.run();
			}
		}

		audit(tx, {
			adminId,
			action: 'assessment.duplicado',
			entityType: 'assessment',
			entityId: copy.id,
			metadata: { origen: original.id, titulo: copy.title },
			ip
		});
		return copy;
	});
}
