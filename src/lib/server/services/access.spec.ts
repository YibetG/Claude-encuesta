import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-db';
import { adminUsers, assessments, participants, submissions } from '../db/schema';
import { assessmentFormSchema } from '../../schemas/assessment';
import { participantSchema } from '../../schemas/participant';
import { createAssessment, getAssessment, setAccessPassword, setStatus } from './assessments';
import { replaceQuestions } from './questions';
import { upsertParticipants } from './participants';
import {
	availability,
	enterAssessment,
	getParticipantContext,
	type ParticipantContext
} from './access';
import {
	AlreadySubmittedError,
	getAnswers,
	listQuestionsForParticipant,
	saveAnswers,
	submitAnswers
} from './answers';
import { createParticipantSession } from '../auth/participant-session';

const HOUR = 3600 * 1000;
const now = new Date('2026-11-05T15:00:00Z');
const PASSWORD = 'acceso-2026';

let db: ReturnType<typeof createTestDb>;
let adminId: string;
let assessmentId: string;

async function setup(accessMode: 'invitados' | 'abierto' = 'invitados') {
	db = createTestDb();
	adminId = db
		.insert(adminUsers)
		.values({ email: 'a@b.co', name: 'Admin', passwordHash: 'x' })
		.returning()
		.get().id;
	assessmentId = createAssessment(
		db,
		assessmentFormSchema.parse({
			title: 'Seguridad',
			description: '',
			instructions: '',
			timezone: 'America/Bogota',
			startsAt: '2026-11-01T08:00',
			endsAt: '2026-11-15T18:00',
			accessMode,
			openMaxChars: '500'
		}),
		adminId
	).id;
	replaceQuestions(
		db,
		assessmentId,
		[
			{
				type: 'opcion_unica',
				prompt: '¿Qué es confidencialidad?',
				required: true,
				options: [
					{ text: 'Acceso solo de autorizados', isCorrect: true },
					{ text: 'Información pública', isCorrect: false }
				]
			},
			{ type: 'abierta', prompt: 'Comente', required: true },
			{ type: 'abierta', prompt: 'Opcional', required: false }
		],
		adminId
	);
	await setAccessPassword(db, assessmentId, PASSWORD, adminId);
	setStatus(db, getAssessment(db, assessmentId)!, 'publicado', adminId);
	upsertParticipants(
		db,
		assessmentId,
		[participantSchema.parse({ name: 'Ana Pérez', email: 'ana@x.co' })],
		adminId
	);
}

const a = () => getAssessment(db, assessmentId)!;
const enter = (
	email: string,
	password = PASSWORD,
	extra: { name?: string; at?: Date; ip?: string } = {}
) =>
	enterAssessment(
		db,
		{ assessment: a(), email, password, name: extra.name ?? null, ip: extra.ip ?? '10.0.0.1' },
		extra.at ?? now
	);

/** Ingresa y devuelve el contexto del participante, como lo haría una petición real. */
async function login(email = 'ana@x.co'): Promise<ParticipantContext & { token: string }> {
	const r = await enter(email);
	if (!r.ok) throw new Error(`no ingresó: ${r.reason}`);
	const { token } = createParticipantSession(db, r.participantId, 72, now);
	const ctx = getParticipantContext(db, { token, slug: a().slug, sessionHours: 72 }, now);
	if (ctx.kind !== 'ok') throw new Error(ctx.kind);
	return { ...ctx, token };
}

describe('disponibilidad', () => {
	it('depende del estado y del rango de fechas', () => {
		const base = {
			status: 'publicado' as const,
			startsAt: new Date(now.getTime() - HOUR),
			endsAt: new Date(now.getTime() + HOUR)
		};
		expect(availability(base, now)).toBe('abierto');
		expect(availability({ ...base, status: 'borrador' }, now)).toBe('no_disponible');
		expect(availability({ ...base, status: 'archivado' }, now)).toBe('no_disponible');
		expect(availability({ ...base, startsAt: new Date(now.getTime() + 1) }, now)).toBe(
			'no_iniciado'
		);
		expect(availability({ ...base, endsAt: now }, now)).toBe('cerrado');
	});
});

describe('ingreso del participante', { timeout: 30_000 }, () => {
	beforeEach(() => setup());

	it('rechaza contraseña incorrecta y emails no invitados', async () => {
		expect(await enter('ana@x.co', 'mala')).toEqual({ ok: false, reason: 'invalid_password' });
		expect(await enter('intruso@x.co')).toEqual({ ok: false, reason: 'not_invited' });
	});

	it('crea la entrega en progreso al primer ingreso y la reutiliza al volver', async () => {
		const r1 = await enter('ana@x.co');
		const r2 = await enter('ana@x.co');
		expect(r1).toEqual(r2);
		expect(db.select().from(submissions).all()).toHaveLength(1);
		expect(db.select().from(submissions).get()?.submittedAt).toBeNull();
	});

	it('solo funciona dentro de las fechas', async () => {
		expect(await enter('ana@x.co', PASSWORD, { at: new Date('2026-10-30T12:00:00Z') })).toEqual({
			ok: false,
			reason: 'no_iniciado'
		});
		expect(await enter('ana@x.co', PASSWORD, { at: new Date('2026-11-16T12:00:00Z') })).toEqual({
			ok: false,
			reason: 'cerrado'
		});
	});

	it('un borrador o archivado no admite ingresos', async () => {
		setStatus(db, a(), 'archivado', adminId);
		expect(await enter('ana@x.co')).toEqual({ ok: false, reason: 'no_disponible' });
	});

	it('bloquea el email tras 5 intentos fallidos, aunque luego acierte', async () => {
		for (let i = 0; i < 4; i++) await enter('ana@x.co', 'mala');
		expect(await enter('ana@x.co', 'mala')).toMatchObject({ reason: 'locked' });
		expect(await enter('ana@x.co')).toMatchObject({ reason: 'locked' });
	});

	it('los fallos desde otra IP no bloquean el email de la persona', async () => {
		for (let i = 0; i < 5; i++) await enter('ana@x.co', 'mala', { ip: '203.0.113.9' });
		expect(await enter('ana@x.co', 'mala', { ip: '203.0.113.9' })).toMatchObject({
			reason: 'locked'
		});
		expect((await enter('ana@x.co')).ok).toBe(true);
	});

	it('al cambiar la contraseña, las sesiones activas siguen y los nuevos ingresos usan la nueva', async () => {
		const ctx = await login();
		await setAccessPassword(db, assessmentId, 'nueva-clave-1', adminId);
		expect(
			getParticipantContext(db, { token: ctx.token, slug: a().slug, sessionHours: 72 }, now).kind
		).toBe('ok');
		expect(await enter('ana@x.co')).toEqual({ ok: false, reason: 'invalid_password' });
		expect((await enter('ana@x.co', 'nueva-clave-1')).ok).toBe(true);
	});

	it('en modo abierto pide el nombre y registra a la persona', async () => {
		await setup('abierto');
		expect(await enter('nuevo@x.co')).toEqual({ ok: false, reason: 'name_required' });
		const r = await enter('nuevo@x.co', PASSWORD, { name: 'Persona Nueva' });
		expect(r.ok).toBe(true);
		const p = db.select().from(participants).where(eq(participants.email, 'nuevo@x.co')).get();
		expect(p).toMatchObject({ name: 'Persona Nueva', source: 'abierto' });
	});
});

describe('contexto en cada petición', { timeout: 30_000 }, () => {
	beforeEach(() => setup());

	it('rechaza otro slug, token inventado y fechas vencidas', async () => {
		const ctx = await login();
		expect(
			getParticipantContext(db, { token: ctx.token, slug: 'otroslug123', sessionHours: 72 }, now)
				.kind
		).toBe('sin_sesion');
		expect(
			getParticipantContext(db, { token: 'inventado', slug: a().slug, sessionHours: 72 }, now).kind
		).toBe('sin_sesion');
		db.update(assessments)
			.set({ endsAt: new Date(now.getTime() - 1) })
			.where(eq(assessments.id, assessmentId))
			.run();
		expect(
			getParticipantContext(db, { token: ctx.token, slug: a().slug, sessionHours: 72 }, now).kind
		).toBe('cerrado');
	});
});

describe('respuestas', { timeout: 30_000 }, () => {
	beforeEach(() => setup());

	it('las preguntas del participante nunca incluyen la opción correcta', () => {
		const qs = listQuestionsForParticipant(db, assessmentId);
		expect(qs).toHaveLength(3);
		const json = JSON.stringify(qs);
		expect(json).not.toMatch(/isCorrect|is_correct|correct/i);
		expect(Object.keys(qs[0].options[0]).sort()).toEqual(['id', 'text']);
	});

	it('guarda, actualiza y borra respuestas validando opción y largo', async () => {
		const ctx = await login();
		const [mc, open] = listQuestionsForParticipant(db, assessmentId);

		expect(saveAnswers(db, ctx, [{ questionId: mc.id, value: 'opcion-falsa' }])).toEqual({
			ok: false,
			errors: ['Pregunta 1: opción no válida.']
		});
		expect(saveAnswers(db, ctx, [{ questionId: open.id, value: 'x'.repeat(501) }])).toMatchObject({
			ok: false
		});
		expect(saveAnswers(db, ctx, [{ questionId: 'no-existe', value: 'x' }])).toMatchObject({
			ok: false
		});

		saveAnswers(db, ctx, [
			{ questionId: mc.id, value: mc.options[1].id },
			{ questionId: open.id, value: 'Primera versión' }
		]);
		saveAnswers(db, ctx, [{ questionId: mc.id, value: mc.options[0].id }]);
		let saved = getAnswers(db, ctx.submission.id);
		expect(saved[mc.id].optionId).toBe(mc.options[0].id);
		expect(saved[open.id].text).toBe('Primera versión');

		saveAnswers(db, ctx, [{ questionId: open.id, value: '   ' }]);
		saved = getAnswers(db, ctx.submission.id);
		expect(saved[open.id]).toBeUndefined();
	});

	it('exige las obligatorias, entrega una sola vez y cierra la sesión', async () => {
		const ctx = await login();
		const [mc, open] = listQuestionsForParticipant(db, assessmentId);

		saveAnswers(db, ctx, [{ questionId: mc.id, value: mc.options[0].id }]);
		expect(submitAnswers(db, ctx, now)).toEqual({ ok: false, missing: [2] });

		saveAnswers(db, ctx, [{ questionId: open.id, value: 'Mi respuesta' }]);
		expect(submitAnswers(db, ctx, now)).toEqual({ ok: true });

		// Ya no se puede guardar, ni entregar de nuevo, ni volver a entrar.
		expect(() => saveAnswers(db, ctx, [{ questionId: open.id, value: 'cambio' }])).toThrow(
			AlreadySubmittedError
		);
		expect(() => submitAnswers(db, ctx, now)).toThrow(AlreadySubmittedError);
		expect(
			getParticipantContext(db, { token: ctx.token, slug: a().slug, sessionHours: 72 }, now).kind
		).toBe('sin_sesion');
		expect(await enter('ana@x.co')).toMatchObject({ ok: false, reason: 'already_submitted' });
		expect(getAnswers(db, ctx.submission.id)[open.id].text).toBe('Mi respuesta');
	});
});
