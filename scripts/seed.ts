// Datos de ejemplo para probar la plataforma: un assessment publicado con 10 preguntas
// (8 de selección y 2 abiertas), participantes y respuestas simuladas.
//
// Uso:
//   npm run db:seed            crea el assessment de ejemplo (si no existe)
//   npm run db:seed -- --reset lo borra y lo vuelve a crear
//
// Requiere un administrador (npm run create-admin). La contraseña de acceso de ejemplo
// es un valor de prueba documentado en el README: no la use en un assessment real.
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { adminUsers, answers, assessments, submissions } from '../src/lib/server/db/schema';
import { assessmentFormSchema } from '../src/lib/schemas/assessment';
import { participantSchema } from '../src/lib/schemas/participant';
import type { QuestionInput } from '../src/lib/schemas/question';
import {
	createAssessment,
	getAssessment,
	setAccessPassword,
	setStatus
} from '../src/lib/server/services/assessments';
import { listQuestionsForAdmin, replaceQuestions } from '../src/lib/server/services/questions';
import { listParticipants, upsertParticipants } from '../src/lib/server/services/participants';
import { toLocalDateTimeInput } from '../src/lib/datetime';

export const SEED_TITLE = 'Assessment de ejemplo: Seguridad de la información';
export const SEED_PASSWORD = 'demo-acceso-2026';
const TZ = 'America/Bogota';
const DAY = 24 * 3600 * 1000;

const { values: args } = parseArgs({ options: { reset: { type: 'boolean', default: false } } });

const opt = (text: string, isCorrect = false) => ({ text, isCorrect });

const QUESTIONS: QuestionInput[] = [
	{
		type: 'opcion_unica',
		prompt: '¿Qué significa la confidencialidad de la información?',
		required: true,
		options: [
			opt('Que solo las personas autorizadas pueden acceder a ella', true),
			opt('Que la información siempre está disponible'),
			opt('Que la información no tiene errores'),
			opt('Que la información se publica para todos')
		]
	},
	{
		type: 'opcion_unica',
		prompt: 'Recibe un correo urgente de "su banco" pidiendo confirmar su contraseña. ¿Qué hace?',
		required: true,
		options: [
			opt('Responde con la contraseña para evitar el bloqueo'),
			opt('No responde, no abre enlaces y lo reporta a seguridad', true),
			opt('Abre el enlace para verificar si es real'),
			opt('Lo reenvía a sus compañeros para alertarlos')
		]
	},
	{
		type: 'opcion_unica',
		prompt: '¿Cuál de estas contraseñas es más segura?',
		required: true,
		options: [
			opt('Empresa2026'),
			opt('123456789'),
			opt('Una frase larga y única, guardada en un gestor de contraseñas', true),
			opt('El nombre de su mascota')
		]
	},
	{
		type: 'opcion_unica',
		prompt: '¿Qué debe hacer al alejarse de su computador en la oficina?',
		required: true,
		options: [
			opt('Bloquear la sesión', true),
			opt('Dejarla abierta si vuelve pronto'),
			opt('Apagar solo la pantalla')
		]
	},
	{
		type: 'opcion_unica',
		prompt: '¿Dónde se deben guardar los documentos con información sensible de clientes?',
		required: true,
		options: [
			opt('En una memoria USB personal'),
			opt('En el correo personal para tenerlos a mano'),
			opt('En los repositorios corporativos autorizados', true),
			opt('En el escritorio del computador')
		]
	},
	{
		type: 'opcion_unica',
		prompt: '¿Qué es la autenticación de dos factores?',
		required: true,
		options: [
			opt('Usar dos contraseñas iguales'),
			opt('Verificar la identidad con algo que sabe y algo que tiene', true),
			opt('Cambiar la contraseña dos veces al año')
		]
	},
	{
		type: 'opcion_unica',
		prompt: 'Un visitante sin identificación le pide entrar a una zona restringida. ¿Qué hace?',
		required: true,
		options: [
			opt('Lo deja pasar si parece amable'),
			opt('Le presta su tarjeta de acceso'),
			opt('Lo dirige a recepción para que lo registren', true),
			opt('Lo ignora')
		]
	},
	{
		type: 'opcion_unica',
		prompt: '¿Qué debe hacer si sospecha que su cuenta fue comprometida?',
		required: false,
		options: [
			opt('Esperar a ver si pasa algo'),
			opt('Cambiar la contraseña y reportar el incidente de inmediato', true),
			opt('Crear una cuenta nueva sin avisar'),
			opt('Comentarlo solo con su equipo')
		]
	},
	{
		type: 'abierta',
		prompt:
			'Describa una situación en la que aplicó (o pudo aplicar) una buena práctica de seguridad.',
		required: true
	},
	{
		type: 'abierta',
		prompt: '¿Qué apoyo o capacitación le ayudaría a proteger mejor la información?',
		required: false
	}
];

/** Probabilidad de elegir la opción esperada en cada pregunta de selección (da variedad al reporte). */
const ALIGNMENT = [0.92, 0.8, 0.7, 0.88, 0.6, 0.5, 0.75, 0.85];

const PEOPLE = [
	['Ana Pérez', 'ana.perez', 'Tecnología', 'Analista'],
	['Luis Gómez', 'luis.gomez', 'Finanzas', 'Coordinador'],
	['María Rodríguez', 'maria.rodriguez', 'Talento Humano', 'Directora'],
	['Carlos Martínez', 'carlos.martinez', 'Operaciones', 'Auxiliar'],
	['Laura Hernández', 'laura.hernandez', 'Tecnología', 'Coordinadora'],
	['Jorge Ramírez', 'jorge.ramirez', 'Finanzas', 'Analista'],
	['Sofía Torres', 'sofia.torres', 'Operaciones', 'Analista'],
	['Andrés Castro', 'andres.castro', 'Tecnología', 'Director'],
	['Valentina Rojas', 'valentina.rojas', 'Talento Humano', 'Analista'],
	['Diego Morales', 'diego.morales', 'Operaciones', 'Coordinador'],
	['Camila Vargas', 'camila.vargas', 'Finanzas', 'Auxiliar'],
	['Felipe Ortiz', 'felipe.ortiz', 'Tecnología', 'Analista'],
	['Natalia Suárez', 'natalia.suarez', 'Talento Humano', 'Auxiliar'],
	['Sebastián Mejía', 'sebastian.mejia', 'Operaciones', 'Director']
] as const;

const OPEN_1 = [
	'Recibí un correo que pedía actualizar mis datos bancarios. Revisé el remitente, no abrí el enlace y lo reporté a seguridad. Luego confirmaron que era phishing.',
	'Cuando salgo a almorzar bloqueo el computador. Antes no lo hacía, pero después de la charla del año pasado lo convertí en hábito.',
	'Un proveedor me pidió enviar una base de datos de clientes por correo personal. Le expliqué que solo podíamos compartirla por el canal autorizado.',
	'Activé la verificación en dos pasos en mi correo corporativo y en el celular. Me tomó cinco minutos.',
	'Encontré una memoria USB en la sala de reuniones y la entregué a soporte en lugar de conectarla.',
	'Una persona sin carné intentó entrar detrás de mí al piso de servidores. Le pedí amablemente que se registrara en recepción.',
	'Cambié contraseñas que reutilizaba en varios sistemas y empecé a usar el gestor de contraseñas de la empresa.',
	'Reporté que una impresora compartida dejaba documentos de nómina a la vista de todos.',
	'Revisé los permisos de una carpeta compartida y quité el acceso a personas que ya no estaban en el proyecto.',
	'Me llamaron diciendo que eran de soporte técnico y pedían mi usuario. Colgué y llamé al número oficial de soporte.'
];

const OPEN_2 = [
	'Simulacros de phishing más frecuentes, con retroalimentación inmediata.',
	'Una guía corta y práctica sobre cómo clasificar la información.',
	'Más tiempo dentro de la jornada para hacer los cursos; siempre quedan para el final.',
	'Capacitación específica para el área de finanzas sobre fraudes por correo.',
	'Que el gestor de contraseñas venga instalado y con una explicación de cómo usarlo.',
	'Un canal sencillo para reportar incidentes desde el celular.',
	'Talleres presenciales cortos, los virtuales largos se hacen pesados.'
];

/** Generador pseudoaleatorio con semilla (mulberry32): los datos son siempre iguales. */
function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('Falta DATABASE_URL en .env');
	const db = createDb(url);
	try {
		const admin = db.select().from(adminUsers).get();
		if (!admin) {
			console.error('Primero cree un administrador: npm run create-admin');
			process.exitCode = 1;
			return;
		}

		const existing = db.select().from(assessments).where(eq(assessments.title, SEED_TITLE)).get();
		if (existing && !args.reset) {
			console.log(`El assessment de ejemplo ya existe. Use --reset para recrearlo.`);
			return;
		}
		if (existing) db.delete(assessments).where(eq(assessments.id, existing.id)).run();

		const now = Date.now();
		const created = createAssessment(
			db,
			assessmentFormSchema.parse({
				title: SEED_TITLE,
				description:
					'Evaluación de conceptos básicos de seguridad de la información para todo el personal.',
				instructions:
					'Responda con base en su experiencia diaria. No hay límite de tiempo y puede guardar y continuar después.',
				timezone: TZ,
				startsAt: toLocalDateTimeInput(now - 2 * DAY, TZ),
				endsAt: toLocalDateTimeInput(now + 30 * DAY, TZ),
				accessMode: 'invitados',
				openMaxChars: '8000'
			}),
			admin.id
		);
		replaceQuestions(db, created.id, QUESTIONS, admin.id);
		await setAccessPassword(db, created.id, SEED_PASSWORD, admin.id);
		setStatus(db, getAssessment(db, created.id)!, 'publicado', admin.id);

		upsertParticipants(
			db,
			created.id,
			PEOPLE.map(([name, user, area, cargo]) =>
				participantSchema.parse({ name, email: `${user}@ejemplo.test`, area, cargo })
			),
			admin.id
		);

		const qs = listQuestionsForAdmin(db, created.id);
		const people = listParticipants(db, created.id);
		const random = rng(2026);

		// 10 entregaron, 2 en progreso, 2 pendientes.
		people.forEach((p, idx) => {
			if (idx >= 12) return;
			const submitted = idx < 10;
			const startedAt = new Date(now - DAY - idx * 3600 * 1000);
			const sub = db
				.insert(submissions)
				.values({
					participantId: p.id,
					assessmentId: created.id,
					startedAt,
					updatedAt: startedAt,
					submittedAt: submitted ? new Date(startedAt.getTime() + 25 * 60 * 1000) : null
				})
				.returning()
				.get();

			let choiceIndex = 0;
			for (const q of qs) {
				if (!submitted && random() < 0.5) continue; // borradores incompletos
				if (q.type === 'opcion_unica') {
					const prob = ALIGNMENT[choiceIndex++];
					if (!q.required && random() < 0.15) continue; // algunas opcionales omitidas
					const expected = q.options.find((o) => o.isCorrect)!;
					const others = q.options.filter((o) => !o.isCorrect);
					const chosen = random() < prob ? expected : others[Math.floor(random() * others.length)];
					db.insert(answers)
						.values({ submissionId: sub.id, questionId: q.id, optionId: chosen.id })
						.run();
				} else {
					const pool = q.prompt.startsWith('Describa') ? OPEN_1 : OPEN_2;
					if (!q.required && random() < 0.3) continue;
					db.insert(answers)
						.values({ submissionId: sub.id, questionId: q.id, text: pool[idx % pool.length] })
						.run();
				}
			}
		});

		console.log(`Assessment de ejemplo creado: "${SEED_TITLE}"`);
		console.log(`  Enlace: /a/${created.slug}`);
		console.log(`  Contraseña de acceso de prueba: ${SEED_PASSWORD}`);
		console.log(`  Participantes: ${people.length} (10 entregas, 2 en progreso, 2 pendientes)`);
	} finally {
		db.$client.close();
	}
}

await main();
