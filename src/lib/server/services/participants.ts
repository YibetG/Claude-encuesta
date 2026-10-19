import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DB } from '../db/client';
import { emailLog, participants, submissions } from '../db/schema';
import { audit } from '../security/audit';
import type { ParticipantInput, ParticipantStatus } from '../../schemas/participant';

export type ParticipantRow = {
	id: string;
	name: string;
	email: string;
	area: string | null;
	cargo: string | null;
	source: 'cargado' | 'abierto';
	invitedAt: Date | null;
	startedAt: Date | null;
	submittedAt: Date | null;
	status: ParticipantStatus;
	lastEmailStatus: 'enviado' | 'error' | null;
	lastEmailError: string | null;
};

export function statusOf(submission: {
	startedAt: Date | null;
	submittedAt: Date | null;
}): ParticipantStatus {
	if (submission.submittedAt) return 'completado';
	if (submission.startedAt) return 'en_progreso';
	return 'pendiente';
}

/** Participantes del assessment con su estado y el resultado del último correo. */
export function listParticipants(db: DB, assessmentId: string): ParticipantRow[] {
	const rows = db
		.select({
			id: participants.id,
			name: participants.name,
			email: participants.email,
			area: participants.area,
			cargo: participants.cargo,
			source: participants.source,
			invitedAt: participants.invitedAt,
			startedAt: submissions.startedAt,
			submittedAt: submissions.submittedAt
		})
		.from(participants)
		.leftJoin(submissions, eq(submissions.participantId, participants.id))
		.where(eq(participants.assessmentId, assessmentId))
		.orderBy(asc(participants.name))
		.all();

	// Último correo por participante (una consulta para todos).
	const lastEmails = new Map<string, { status: 'enviado' | 'error'; error: string | null }>();
	if (rows.length) {
		const logs = db
			.select({
				participantId: emailLog.participantId,
				status: emailLog.status,
				error: emailLog.error
			})
			.from(emailLog)
			.innerJoin(participants, eq(emailLog.participantId, participants.id))
			.where(eq(participants.assessmentId, assessmentId))
			.orderBy(desc(emailLog.createdAt))
			.all();
		for (const l of logs) {
			if (!lastEmails.has(l.participantId)) lastEmails.set(l.participantId, l);
		}
	}

	return rows.map((r) => {
		const last = lastEmails.get(r.id);
		return {
			...r,
			status: statusOf(r),
			lastEmailStatus: last?.status ?? null,
			lastEmailError: last?.error ?? null
		};
	});
}

export class ParticipantExistsError extends Error {
	constructor(email: string) {
		super(`Ya existe un participante con el email ${email}.`);
	}
}

export function addParticipant(
	db: DB,
	assessmentId: string,
	input: ParticipantInput,
	adminId: string,
	ip?: string
) {
	const exists = db
		.select({ id: participants.id })
		.from(participants)
		.where(and(eq(participants.assessmentId, assessmentId), eq(participants.email, input.email)))
		.get();
	if (exists) throw new ParticipantExistsError(input.email);

	const created = db
		.insert(participants)
		.values({ ...input, assessmentId, source: 'cargado' })
		.returning()
		.get();
	audit(db, {
		adminId,
		action: 'participantes.cargados',
		entityType: 'assessment',
		entityId: assessmentId,
		metadata: { nuevos: 1, email: input.email },
		ip
	});
	return created;
}

/**
 * Carga masiva: crea los emails nuevos y actualiza nombre/área/cargo/extra de los existentes.
 * Todo en una transacción.
 */
export function upsertParticipants(
	db: DB,
	assessmentId: string,
	list: ParticipantInput[],
	adminId: string,
	ip?: string
) {
	return db.transaction((tx) => {
		const existing = new Set(
			tx
				.select({ email: participants.email })
				.from(participants)
				.where(eq(participants.assessmentId, assessmentId))
				.all()
				.map((p) => p.email)
		);

		let created = 0;
		let updated = 0;
		for (const p of list) {
			if (existing.has(p.email)) {
				tx.update(participants)
					.set({ name: p.name, area: p.area, cargo: p.cargo, extra: p.extra })
					.where(and(eq(participants.assessmentId, assessmentId), eq(participants.email, p.email)))
					.run();
				updated++;
			} else {
				tx.insert(participants)
					.values({ ...p, assessmentId, source: 'cargado' })
					.run();
				existing.add(p.email);
				created++;
			}
		}

		audit(tx, {
			adminId,
			action: 'participantes.cargados',
			entityType: 'assessment',
			entityId: assessmentId,
			metadata: { nuevos: created, actualizados: updated },
			ip
		});
		return { created, updated };
	});
}

export class ParticipantHasResponsesError extends Error {
	constructor() {
		super('No se puede eliminar: este participante ya empezó a responder.');
	}
}

/** Elimina un participante que todavía no ha empezado a responder. */
export function deleteParticipant(
	db: DB,
	assessmentId: string,
	participantId: string,
	adminId: string,
	ip?: string
): boolean {
	return db.transaction((tx) => {
		const p = tx
			.select({ id: participants.id, email: participants.email })
			.from(participants)
			.where(and(eq(participants.id, participantId), eq(participants.assessmentId, assessmentId)))
			.get();
		if (!p) return false;

		const started = tx
			.select({ id: submissions.id })
			.from(submissions)
			.where(eq(submissions.participantId, p.id))
			.get();
		if (started) throw new ParticipantHasResponsesError();

		tx.delete(participants).where(eq(participants.id, p.id)).run();
		audit(tx, {
			adminId,
			action: 'participantes.eliminado',
			entityType: 'assessment',
			entityId: assessmentId,
			metadata: { email: p.email },
			ip
		});
		return true;
	});
}

/** Valores distintos de área y cargo, para los filtros. */
export function distinctAreasAndCargos(db: DB, assessmentId: string) {
	const pick = (col: typeof participants.area | typeof participants.cargo) =>
		db
			.selectDistinct({ v: col })
			.from(participants)
			.where(and(eq(participants.assessmentId, assessmentId), isNotNull(col)))
			.orderBy(asc(col))
			.all()
			.map((r) => r.v as string);
	return { areas: pick(participants.area), cargos: pick(participants.cargo) };
}

/** Marca como invitados y registra el resultado de cada envío. */
export function recordEmailResults(
	db: DB,
	results: { participantId: string; ok: boolean; error?: string }[],
	adminId: string,
	now = new Date()
) {
	db.transaction((tx) => {
		for (const r of results) {
			tx.insert(emailLog)
				.values({
					participantId: r.participantId,
					status: r.ok ? 'enviado' : 'error',
					error: r.ok ? null : (r.error ?? 'Error desconocido').slice(0, 500),
					sentById: adminId,
					createdAt: now
				})
				.run();
		}
		const okIds = results.filter((r) => r.ok).map((r) => r.participantId);
		if (okIds.length) {
			tx.update(participants).set({ invitedAt: now }).where(inArray(participants.id, okIds)).run();
		}
	});
}

export function participantCounts(list: ParticipantRow[]) {
	const c = { total: list.length, pendiente: 0, en_progreso: 0, completado: 0, sinInvitar: 0 };
	for (const p of list) {
		c[p.status]++;
		if (!p.invitedAt) c.sinInvitar++;
	}
	return c;
}
