import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { assessments, participants, questions, submissions } from './schema';

let db: ReturnType<typeof createTestDb>;

beforeEach(() => {
	db = createTestDb();
});

function crearAssessment() {
	const [a] = db
		.insert(assessments)
		.values({
			slug: crypto.randomUUID(),
			title: 'Prueba',
			startsAt: new Date('2026-01-01T00:00:00Z'),
			endsAt: new Date('2026-12-31T00:00:00Z')
		})
		.returning()
		.all();
	return a;
}

describe('esquema de base de datos', () => {
	it('aplica valores por defecto del assessment', () => {
		const a = crearAssessment();
		expect(a.timezone).toBe('America/Bogota');
		expect(a.accessMode).toBe('invitados');
		expect(a.status).toBe('borrador');
		expect(a.openMaxChars).toBe(8000);
		expect(a.createdAt).toBeInstanceOf(Date);
	});

	it('no permite dos participantes con el mismo email en un assessment', () => {
		const a = crearAssessment();
		const p = { assessmentId: a.id, name: 'Ana', email: 'ana@ejemplo.com' };
		db.insert(participants).values(p).run();
		expect(() => db.insert(participants).values(p).run()).toThrow(/UNIQUE/);
	});

	it('permite una sola entrega (submission) por participante', () => {
		const a = crearAssessment();
		const [p] = db
			.insert(participants)
			.values({ assessmentId: a.id, name: 'Ana', email: 'ana@ejemplo.com' })
			.returning()
			.all();
		db.insert(submissions).values({ participantId: p.id, assessmentId: a.id }).run();
		expect(() =>
			db.insert(submissions).values({ participantId: p.id, assessmentId: a.id }).run()
		).toThrow(/UNIQUE/);
	});

	it('borra en cascada las preguntas al eliminar el assessment', () => {
		const a = crearAssessment();
		db.insert(questions)
			.values({ assessmentId: a.id, type: 'abierta', prompt: '¿?', position: 1 })
			.run();
		db.delete(assessments).where(eq(assessments.id, a.id)).run();
		expect(db.select().from(questions).all()).toHaveLength(0);
	});
});
