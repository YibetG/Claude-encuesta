import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { assessments, participants, submissions } from '../db/schema';
import { verifyPassword } from '../auth/password';
import { validateParticipantSession } from '../auth/participant-session';
import {
	clearFailures,
	limitKeys,
	lockedUntil,
	PARTICIPANT_IP_POLICY,
	recordFailure,
	withKeyLock,
	type LimitKey
} from '../security/rate-limit';
import type { Assessment } from './assessments';

export type Availability = 'no_disponible' | 'no_iniciado' | 'cerrado' | 'abierto';

/** ¿Se puede responder ahora? Solo assessments publicados y dentro del rango de fechas. */
export function availability(
	a: Pick<Assessment, 'status' | 'startsAt' | 'endsAt'>,
	now = new Date()
): Availability {
	if (a.status !== 'publicado') return 'no_disponible';
	if (now < a.startsAt) return 'no_iniciado';
	if (now >= a.endsAt) return 'cerrado';
	return 'abierto';
}

export function getAssessmentBySlug(db: DB, slug: string): Assessment | undefined {
	if (!/^[a-z0-9]{6,32}$/.test(slug)) return undefined;
	return db.select().from(assessments).where(eq(assessments.slug, slug)).get();
}

export type EnterResult =
	| { ok: true; participantId: string }
	| { ok: false; reason: Exclude<Availability, 'abierto'> }
	| { ok: false; reason: 'locked'; until: Date }
	| { ok: false; reason: 'invalid_password' | 'not_invited' | 'name_required' }
	| { ok: false; reason: 'already_submitted'; submittedAt: Date };

/**
 * Valida el ingreso de un participante (contraseña compartida + email).
 * - Rate limiting por IP y por email (por assessment).
 * - Modo "invitados": el email debe estar cargado. Modo "abierto": se registra si es nuevo.
 * - Una sola entrega por email: si ya entregó, no puede volver a entrar.
 * - Crea la entrega (en progreso) la primera vez, lo que bloquea la edición de preguntas.
 */
export async function enterAssessment(
	db: DB,
	input: {
		assessment: Assessment;
		email: string;
		password: string;
		name?: string | null;
		ip: string;
	},
	now = new Date()
): Promise<EnterResult> {
	const a = input.assessment;
	const avail = availability(a, now);
	if (avail !== 'abierto') return { ok: false, reason: avail };

	const keys = limitKeys(`acceso:${a.id}`, input.ip, input.email, PARTICIPANT_IP_POLICY);
	// Los intentos con la misma IP o el mismo email se procesan de a uno (ver withKeyLock).
	return withKeyLock(
		keys.map((k) => k.key),
		() => enterLocked(db, input, keys, now)
	);
}

async function enterLocked(
	db: DB,
	input: { assessment: Assessment; email: string; password: string; name?: string | null },
	keys: LimitKey[],
	now: Date
): Promise<EnterResult> {
	const a = input.assessment;
	const blocked = lockedUntil(db, keys, now);
	if (blocked) return { ok: false, reason: 'locked', until: blocked };

	const fail = (reason: 'invalid_password' | 'not_invited'): EnterResult => {
		const until = recordFailure(db, keys, now);
		return until ? { ok: false, reason: 'locked', until } : { ok: false, reason };
	};

	const passwordOk =
		!!a.accessPasswordHash && (await verifyPassword(a.accessPasswordHash, input.password));
	if (!passwordOk) return fail('invalid_password');

	let participant = db
		.select({ id: participants.id })
		.from(participants)
		.where(and(eq(participants.assessmentId, a.id), eq(participants.email, input.email)))
		.get();

	if (!participant) {
		if (a.accessMode === 'invitados') return fail('not_invited');
		if (!input.name) return { ok: false, reason: 'name_required' };
		// Modo abierto: se registra al participante. onConflictDoNothing cubre dos ingresos simultáneos.
		db.insert(participants)
			.values({ assessmentId: a.id, email: input.email, name: input.name, source: 'abierto' })
			.onConflictDoNothing()
			.run();
		participant = db
			.select({ id: participants.id })
			.from(participants)
			.where(and(eq(participants.assessmentId, a.id), eq(participants.email, input.email)))
			.get()!;
	}

	const existing = db
		.select({ submittedAt: submissions.submittedAt })
		.from(submissions)
		.where(eq(submissions.participantId, participant.id))
		.get();
	if (existing?.submittedAt)
		return { ok: false, reason: 'already_submitted', submittedAt: existing.submittedAt };

	clearFailures(db, [keys[1].key]);
	if (!existing) {
		db.insert(submissions)
			.values({ participantId: participant.id, assessmentId: a.id, startedAt: now, updatedAt: now })
			.onConflictDoNothing()
			.run();
	}
	return { ok: true, participantId: participant.id };
}

export type ParticipantContext = {
	assessment: Assessment;
	participant: { id: string; name: string; email: string };
	submission: { id: string; startedAt: Date; updatedAt: Date };
};

export type ContextResult =
	| ({ kind: 'ok'; sessionExpiresAt: Date } & ParticipantContext)
	| { kind: 'sin_sesion' }
	| { kind: 'entregado' }
	| { kind: Exclude<Availability, 'abierto'> };

/**
 * Verificación que se hace en CADA petición del participante:
 * sesión válida para este assessment, que no haya entregado y que esté dentro de las fechas.
 */
export function getParticipantContext(
	db: DB,
	opts: { token: string | undefined; slug: string; sessionHours: number },
	now = new Date()
): ContextResult {
	if (!opts.token) return { kind: 'sin_sesion' };
	const session = validateParticipantSession(db, opts.token, opts.sessionHours, now);
	if (!session) return { kind: 'sin_sesion' };

	const row = db
		.select({
			participant: { id: participants.id, name: participants.name, email: participants.email },
			assessment: assessments,
			submission: {
				id: submissions.id,
				startedAt: submissions.startedAt,
				updatedAt: submissions.updatedAt,
				submittedAt: submissions.submittedAt
			}
		})
		.from(participants)
		.innerJoin(assessments, eq(assessments.id, participants.assessmentId))
		.innerJoin(submissions, eq(submissions.participantId, participants.id))
		.where(eq(participants.id, session.participantId))
		.get();

	// La sesión debe pertenecer al assessment de la URL.
	if (!row || row.assessment.slug !== opts.slug) return { kind: 'sin_sesion' };
	if (row.submission.submittedAt) return { kind: 'entregado' };

	const avail = availability(row.assessment, now);
	if (avail !== 'abierto') return { kind: avail };

	const { id, startedAt, updatedAt } = row.submission;
	return {
		kind: 'ok',
		assessment: row.assessment,
		participant: row.participant,
		submission: { id, startedAt, updatedAt },
		sessionExpiresAt: session.expiresAt
	};
}
