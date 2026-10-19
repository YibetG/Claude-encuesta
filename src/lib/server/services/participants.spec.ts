import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { adminUsers, auditLog, emailLog, submissions } from '../db/schema';
import { assessmentFormSchema } from '../../schemas/assessment';
import { participantSchema } from '../../schemas/participant';
import { createAssessment, getAssessment, setAccessPassword } from './assessments';
import {
	addParticipant,
	deleteParticipant,
	distinctAreasAndCargos,
	listParticipants,
	ParticipantExistsError,
	ParticipantHasResponsesError,
	participantCounts,
	upsertParticipants
} from './participants';
import { checkAccessPassword, genericMessage, sendInvitations } from './invitations';
import type { Mailer, MailMessage } from '../email/mailer';
import { parseParticipantRows } from '../import/participants-import';
import {
	inviteTemplateSchema,
	renderGeneric,
	renderTemplate,
	textToHtml
} from '../../invite-template';

let db: ReturnType<typeof createTestDb>;
let adminId: string;
let assessmentId: string;

const p = (name: string, email: string, area?: string) =>
	participantSchema.parse({ name, email, area: area ?? '', cargo: '' });

beforeEach(() => {
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
			accessMode: 'invitados',
			openMaxChars: '8000'
		}),
		adminId
	).id;
});

describe('participantes', () => {
	it('normaliza el email y no permite duplicados', () => {
		addParticipant(db, assessmentId, p('Ana', ' ANA@Empresa.com '), adminId);
		expect(listParticipants(db, assessmentId)[0].email).toBe('ana@empresa.com');
		expect(() => addParticipant(db, assessmentId, p('Ana 2', 'ana@empresa.com'), adminId)).toThrow(
			ParticipantExistsError
		);
	});

	it('la carga masiva crea nuevos y actualiza existentes', () => {
		addParticipant(db, assessmentId, p('Ana', 'ana@empresa.com', 'TI'), adminId);
		const r = upsertParticipants(
			db,
			assessmentId,
			[p('Ana Pérez', 'ana@empresa.com', 'Finanzas'), p('Luis', 'luis@empresa.com')],
			adminId
		);
		expect(r).toEqual({ created: 1, updated: 1 });
		const list = listParticipants(db, assessmentId);
		expect(list.map((x) => [x.name, x.area])).toEqual([
			['Ana Pérez', 'Finanzas'],
			['Luis', null]
		]);
		expect(distinctAreasAndCargos(db, assessmentId).areas).toEqual(['Finanzas']);
	});

	it('calcula el estado: pendiente, en progreso, completado', () => {
		upsertParticipants(
			db,
			assessmentId,
			[p('Ana', 'a@x.co'), p('Bea', 'b@x.co'), p('Cris', 'c@x.co')],
			adminId
		);
		const [a, b] = listParticipants(db, assessmentId);
		db.insert(submissions).values({ participantId: a.id, assessmentId }).run();
		db.insert(submissions)
			.values({ participantId: b.id, assessmentId, submittedAt: new Date() })
			.run();
		const list = listParticipants(db, assessmentId);
		expect(list.map((x) => x.status)).toEqual(['en_progreso', 'completado', 'pendiente']);
		expect(participantCounts(list)).toMatchObject({
			total: 3,
			pendiente: 1,
			en_progreso: 1,
			completado: 1
		});
	});

	it('no elimina a quien ya empezó a responder', () => {
		const ana = addParticipant(db, assessmentId, p('Ana', 'ana@x.co'), adminId);
		const luis = addParticipant(db, assessmentId, p('Luis', 'luis@x.co'), adminId);
		db.insert(submissions).values({ participantId: ana.id, assessmentId }).run();
		expect(() => deleteParticipant(db, assessmentId, ana.id, adminId)).toThrow(
			ParticipantHasResponsesError
		);
		expect(deleteParticipant(db, assessmentId, luis.id, adminId)).toBe(true);
		// Un id de otro assessment no se puede borrar desde aquí.
		expect(deleteParticipant(db, 'otro', ana.id, adminId)).toBe(false);
	});
});

describe('importación de participantes', () => {
	it('lee columnas conocidas y guarda las demás como datos adicionales', () => {
		const r = parseParticipantRows({
			headers: ['nombre', 'correo', 'area', 'cargo', 'sede'],
			rows: [['Ana', 'ANA@x.co', 'TI', 'Analista', 'Bogotá']]
		});
		expect(r).toEqual({
			ok: true,
			participants: [
				{
					name: 'Ana',
					email: 'ana@x.co',
					area: 'TI',
					cargo: 'Analista',
					extra: { sede: 'Bogotá' }
				}
			]
		});
	});

	it('detecta emails inválidos y repetidos con el número de fila', () => {
		const r = parseParticipantRows({
			headers: ['nombre', 'email'],
			rows: [
				['Ana', 'ana@x.co'],
				['Luis', 'no-es-email'],
				['Ana bis', 'Ana@x.co']
			]
		});
		expect(r).toEqual({
			ok: false,
			errors: [
				'Fila 3: Escriba un email válido.',
				'Fila 4: el email ana@x.co ya aparece en la fila 2.'
			]
		});
	});
});

describe('plantilla de invitación', () => {
	it('reemplaza variables y deja intactas las desconocidas', () => {
		expect(renderTemplate('Hola {{ nombre }}, {{otra}}', { nombre: 'Ana' })).toBe(
			'Hola Ana, {{otra}}'
		);
	});

	it('el mensaje genérico no deja "Hola ,"', () => {
		const vars = {
			titulo: 'T',
			descripcion: '',
			enlace: 'http://x/a/abc',
			contrasena: 'k',
			inicio: 'i',
			fin: 'f',
			zona_horaria: 'z'
		};
		expect(renderGeneric('Hola {{nombre}},\n{{enlace}}', vars)).toBe('Hola,\nhttp://x/a/abc');
	});

	it('el HTML escapa el contenido y convierte enlaces', () => {
		const html = textToHtml('Hola <script>alert(1)</script>\nhttps://x.co/a/abc');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('<a href="https://x.co/a/abc">');
		expect(html).toContain('<br>');
	});

	it('exige {{enlace}} y {{contrasena}} en el mensaje', () => {
		const r = inviteTemplateSchema.safeParse({ subject: 'S', body: 'Hola {{nombre}}' });
		expect(r.success).toBe(false);
		expect(r.error?.issues.map((i) => i.message)).toEqual([
			'El mensaje debe incluir {{enlace}}.',
			'El mensaje debe incluir {{contrasena}}.'
		]);
	});
});

describe('envío de invitaciones', { timeout: 30_000 }, () => {
	function fakeMailer(failFor: string[] = []) {
		const sent: MailMessage[] = [];
		const mailer: Mailer = {
			kind: 'consola',
			async send(m) {
				if (failFor.includes(m.to)) throw new Error('Buzón inexistente');
				sent.push(m);
			}
		};
		return { mailer, sent };
	}

	it('verifica la contraseña de acceso escrita por el admin', async () => {
		await setAccessPassword(db, assessmentId, 'acceso-2026', adminId);
		const a = getAssessment(db, assessmentId)!;
		expect(await checkAccessPassword(a, 'acceso-2026')).toBe(true);
		expect(await checkAccessPassword(a, 'otra')).toBe(false);
	});

	it('envía a quienes no han sido invitados, personaliza y registra resultados', async () => {
		await setAccessPassword(db, assessmentId, 'acceso-2026', adminId);
		upsertParticipants(
			db,
			assessmentId,
			[p('Ana', 'ana@x.co'), p('Luis', 'luis@x.co'), p('Eva', 'eva@x.co')],
			adminId
		);
		const eva = listParticipants(db, assessmentId).find((x) => x.email === 'eva@x.co')!;
		db.insert(submissions)
			.values({ participantId: eva.id, assessmentId, submittedAt: new Date() })
			.run();

		const { mailer, sent } = fakeMailer(['luis@x.co']);
		const a = getAssessment(db, assessmentId)!;
		const r = await sendInvitations(db, mailer, {
			assessment: a,
			mode: 'sin_invitar',
			password: 'acceso-2026',
			appUrl: 'https://evaluaciones.ejemplo.com/',
			adminId
		});

		expect(r).toEqual({ sent: 1, failed: 1, total: 2 });
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('ana@x.co');
		expect(sent[0].subject).toBe('Invitación: Seguridad');
		expect(sent[0].text).toContain('Hola Ana,');
		expect(sent[0].text).toContain(`https://evaluaciones.ejemplo.com/a/${a.slug}`);
		expect(sent[0].text).toContain('Contraseña de acceso: acceso-2026');
		expect(sent[0].text).toContain('1 de noviembre de 2026');

		const list = listParticipants(db, assessmentId);
		const ana = list.find((x) => x.email === 'ana@x.co')!;
		const luis = list.find((x) => x.email === 'luis@x.co')!;
		expect(ana.invitedAt).toBeInstanceOf(Date);
		expect(ana.lastEmailStatus).toBe('enviado');
		expect(luis.invitedAt).toBeNull();
		expect(luis.lastEmailStatus).toBe('error');
		expect(luis.lastEmailError).toBe('Buzón inexistente');
		expect(db.select().from(emailLog).all()).toHaveLength(2);

		// Un segundo envío "sin invitar" solo reintenta a Luis.
		const again = await sendInvitations(db, fakeMailer().mailer, {
			assessment: a,
			mode: 'sin_invitar',
			password: 'acceso-2026',
			appUrl: 'https://x.co',
			adminId
		});
		expect(again).toEqual({ sent: 1, failed: 0, total: 1 });

		const audits = db
			.select()
			.from(auditLog)
			.all()
			.filter((x) => x.action === 'invitaciones.enviadas');
		expect(audits[0].metadata).toMatchObject({ enviados: 1, fallidos: 1 });
		// La contraseña nunca queda en la auditoría.
		expect(JSON.stringify(audits)).not.toContain('acceso-2026');
	});

	it('genera el mensaje genérico para copiar', async () => {
		const a = getAssessment(db, assessmentId)!;
		const m = genericMessage(a, 'acceso-2026', 'http://localhost:5173');
		expect(m.body.startsWith('Hola,')).toBe(true);
		expect(m.body).toContain(`http://localhost:5173/a/${a.slug}`);
	});
});
