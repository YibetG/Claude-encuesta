import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-db';
import { adminUsers, auditLog, participants, questionOptions, submissions } from '../db/schema';
import {
	createAssessment,
	duplicateAssessment,
	generateSlug,
	getAssessment,
	listAssessments,
	detectLogoType,
	LogoError,
	publishProblems,
	readAccessPassword,
	revealAccessPassword,
	setAccessPassword,
	setLogo,
	setStatus
} from './assessments';
import { listQuestionsForAdmin, QuestionsLockedError, replaceQuestions } from './questions';
import { assessmentFormSchema } from '../../schemas/assessment';
import type { QuestionInput } from '../../schemas/question';

let db: ReturnType<typeof createTestDb>;
let adminId: string;

const input = assessmentFormSchema.parse({
	title: 'Evaluación de seguridad',
	description: 'Descripción',
	instructions: 'Responda con calma',
	timezone: 'America/Bogota',
	startsAt: '2026-11-01T08:00',
	endsAt: '2026-11-15T18:00',
	accessMode: 'invitados',
	openMaxChars: '8000'
});

const preguntas: QuestionInput[] = [
	{
		type: 'opcion_unica',
		prompt: '¿Qué es confidencialidad?',
		required: true,
		options: [
			{ text: 'Que solo accedan los autorizados', isCorrect: true },
			{ text: 'Que todo sea público', isCorrect: false }
		]
	},
	{ type: 'abierta', prompt: 'Comente un caso real', required: false }
];

beforeEach(() => {
	db = createTestDb();
	adminId = db
		.insert(adminUsers)
		.values({ email: 'a@b.co', name: 'Admin', passwordHash: 'x' })
		.returning()
		.get().id;
});

describe('assessments', () => {
	it('genera slugs aleatorios de 12 caracteres sin caracteres ambiguos', () => {
		const slugs = new Set(Array.from({ length: 200 }, generateSlug));
		expect(slugs.size).toBe(200);
		for (const s of slugs) expect(s).toMatch(/^[a-km-np-z2-9]{12}$/);
	});

	it('la validación convierte las fechas a UTC según la zona horaria', () => {
		expect(input.startsAt.toISOString()).toBe('2026-11-01T13:00:00.000Z');
		const malo = assessmentFormSchema.safeParse({
			...input,
			startsAt: '2026-11-15T18:00',
			endsAt: '2026-11-01T08:00'
		});
		expect(malo.success).toBe(false);
	});

	it('crea, audita y lista con conteos', () => {
		const a = createAssessment(db, input, adminId);
		replaceQuestions(db, a.id, preguntas, adminId);
		const [row] = listAssessments(db);
		expect(row).toMatchObject({
			id: a.id,
			questionCount: 2,
			participantCount: 0,
			submittedCount: 0
		});
		const acciones = db
			.select()
			.from(auditLog)
			.all()
			.map((r) => r.action);
		expect(acciones).toEqual(['assessment.creado', 'preguntas.editadas']);
	});

	it('exige contraseña y preguntas para publicar', async () => {
		const a = createAssessment(db, input, adminId);
		expect(publishProblems(db, a)).toEqual([
			'Defina la contraseña de acceso.',
			'Agregue al menos una pregunta.'
		]);
		await setAccessPassword(db, a.id, 'clave-acceso', adminId);
		replaceQuestions(db, a.id, preguntas, adminId);
		expect(publishProblems(db, getAssessment(db, a.id)!)).toEqual([]);
		expect(getAssessment(db, a.id)!.accessPasswordHash).toMatch(/^\$argon2id\$/);
	});

	it('los archivados no aparecen en la lista por defecto', () => {
		const a = createAssessment(db, input, adminId);
		setStatus(db, a, 'archivado', adminId);
		expect(listAssessments(db)).toHaveLength(0);
		expect(listAssessments(db, { includeArchived: true })).toHaveLength(1);
	});

	it('duplica preguntas y opciones, en borrador y sin contraseña', async () => {
		const a = createAssessment(db, input, adminId);
		await setAccessPassword(db, a.id, 'clave-acceso', adminId);
		replaceQuestions(db, a.id, preguntas, adminId);
		setStatus(db, getAssessment(db, a.id)!, 'publicado', adminId);

		const copy = duplicateAssessment(db, a.id, adminId)!;
		expect(copy.title).toBe('Copia de Evaluación de seguridad');
		expect(copy.status).toBe('borrador');
		expect(copy.accessPasswordHash).toBeNull();
		expect(copy.slug).not.toBe(a.slug);

		const qs = listQuestionsForAdmin(db, copy.id);
		expect(qs.map((q) => q.prompt)).toEqual(preguntas.map((p) => p.prompt));
		expect(qs[0].options.map((o) => o.isCorrect)).toEqual([true, false]);
		// Las opciones de la copia son filas nuevas.
		const original = listQuestionsForAdmin(db, a.id);
		expect(qs[0].options[0].id).not.toBe(original[0].options[0].id);
	});
});

describe('preguntas', () => {
	it('reemplaza en orden y guarda la opción correcta', () => {
		const a = createAssessment(db, input, adminId);
		replaceQuestions(db, a.id, preguntas, adminId);
		replaceQuestions(db, a.id, [...preguntas].reverse(), adminId);
		const qs = listQuestionsForAdmin(db, a.id);
		expect(qs.map((q) => [q.position, q.type])).toEqual([
			[1, 'abierta'],
			[2, 'opcion_unica']
		]);
		// Las opciones de la versión anterior se borraron en cascada.
		expect(db.select().from(questionOptions).all()).toHaveLength(2);
	});

	it('bloquea la edición cuando ya hay respuestas', () => {
		const a = createAssessment(db, input, adminId);
		replaceQuestions(db, a.id, preguntas, adminId);
		const p = db
			.insert(participants)
			.values({ assessmentId: a.id, name: 'Ana', email: 'ana@x.co' })
			.returning()
			.get();
		db.insert(submissions).values({ assessmentId: a.id, participantId: p.id }).run();

		expect(() => replaceQuestions(db, a.id, [], adminId)).toThrow(QuestionsLockedError);
		expect(listQuestionsForAdmin(db, a.id)).toHaveLength(2);
		// Se puede duplicar para editar la copia.
		const copy = duplicateAssessment(db, a.id, adminId)!;
		expect(() => replaceQuestions(db, copy.id, [], adminId)).not.toThrow();
		expect(
			db.select().from(submissions).where(eq(submissions.assessmentId, copy.id)).all()
		).toHaveLength(0);
	});
});

// PNG mínimo válido (1×1) para las pruebas de logo.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

describe('contraseña de acceso visible y logo', () => {
	it('guarda la contraseña cifrada, permite verla y lo registra en auditoría', async () => {
		const a = createAssessment(db, input, adminId);
		await setAccessPassword(db, a.id, 'clave-visible-1', adminId);
		const saved = getAssessment(db, a.id)!;
		expect(saved.accessPasswordEnc).toMatch(/^v1:/);
		expect(saved.accessPasswordEnc).not.toContain('clave-visible-1');
		expect(readAccessPassword(saved)).toBe('clave-visible-1');

		expect(revealAccessPassword(db, saved, adminId, '10.0.0.1')).toBe('clave-visible-1');
		const vistas = db
			.select()
			.from(auditLog)
			.all()
			.filter((r) => r.action === 'assessment.password_vista');
		expect(vistas).toHaveLength(1);
		expect(JSON.stringify(vistas)).not.toContain('clave-visible-1');
	});

	it('una contraseña definida antes (solo hash) no se puede ver', () => {
		const a = createAssessment(db, input, adminId);
		expect(readAccessPassword(a)).toBeNull();
		expect(revealAccessPassword(db, a, adminId)).toBeNull();
	});

	it('detecta el tipo del logo por su contenido y rechaza lo demás', () => {
		expect(detectLogoType(PNG)).toBe('image/png');
		expect(detectLogoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
		expect(() =>
			detectLogoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))
		).toThrow(LogoError);
		expect(() => detectLogoType(Buffer.alloc(0))).toThrow('Seleccione una imagen');
		expect(() => detectLogoType(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]))).toThrow(
			'2 MB'
		);
	});

	it('guarda, quita y copia el logo al duplicar', () => {
		const a = createAssessment(db, input, adminId);
		setLogo(db, a.id, PNG, adminId);
		expect(getAssessment(db, a.id)!.logoMime).toBe('image/png');
		const copy = duplicateAssessment(db, a.id, adminId)!;
		expect(copy.logoData?.equals(PNG)).toBe(true);
		setLogo(db, a.id, null, adminId);
		expect(getAssessment(db, a.id)!.logoData).toBeNull();
	});
});
