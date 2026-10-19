import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { ACCESS_MODES, ASSESSMENT_STATUSES, QUESTION_TYPES } from '../../constants';

// Esquema completo de la base de datos.
// Convenciones:
// - Ids de texto (UUID) para no exponer conteos ni permitir adivinar registros.
// - Fechas como enteros en milisegundos UTC (`timestamp_ms`); la zona horaria
//   del assessment solo se usa para mostrar y para interpretar lo que escribe el admin.
// - Los ids de sesión guardados son el SHA-256 del token: si se filtra la base,
//   no se pueden reutilizar las cookies.

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

// ---------------------------------------------------------------
// Administradores
// ---------------------------------------------------------------

export const adminUsers = sqliteTable('admin_users', {
	id: id(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	passwordHash: text('password_hash').notNull(),
	lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
	createdAt: createdAt()
});

export const adminSessions = sqliteTable(
	'admin_sessions',
	{
		id: text('id').primaryKey(),
		adminId: text('admin_id')
			.notNull()
			.references(() => adminUsers.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(t) => [index('admin_sessions_admin_idx').on(t.adminId)]
);

// ---------------------------------------------------------------
// Assessments y preguntas
// ---------------------------------------------------------------

export { ACCESS_MODES, ASSESSMENT_STATUSES, QUESTION_TYPES };

export const assessments = sqliteTable('assessments', {
	id: id(),
	/** Identificador aleatorio del link público /a/[slug]. */
	slug: text('slug').notNull().unique(),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	instructions: text('instructions').notNull().default(''),
	startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
	endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
	timezone: text('timezone').notNull().default('America/Bogota'),
	accessMode: text('access_mode', { enum: ACCESS_MODES }).notNull().default('invitados'),
	/** Hash Argon2id de la contraseña compartida. Nunca se guarda en claro. */
	accessPasswordHash: text('access_password_hash'),
	openMaxChars: integer('open_max_chars').notNull().default(8000),
	status: text('status', { enum: ASSESSMENT_STATUSES }).notNull().default('borrador'),
	inviteSubject: text('invite_subject').notNull().default(''),
	inviteBody: text('invite_body').notNull().default(''),
	duplicatedFromId: text('duplicated_from_id'),
	createdById: text('created_by_id').references(() => adminUsers.id, { onDelete: 'set null' }),
	createdAt: createdAt(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`)
});

export const questions = sqliteTable(
	'questions',
	{
		id: id(),
		assessmentId: text('assessment_id')
			.notNull()
			.references(() => assessments.id, { onDelete: 'cascade' }),
		type: text('type', { enum: QUESTION_TYPES }).notNull(),
		prompt: text('prompt').notNull(),
		position: integer('position').notNull(),
		required: integer('required', { mode: 'boolean' }).notNull().default(true),
		createdAt: createdAt()
	},
	(t) => [index('questions_assessment_idx').on(t.assessmentId, t.position)]
);

export const questionOptions = sqliteTable(
	'question_options',
	{
		id: id(),
		questionId: text('question_id')
			.notNull()
			.references(() => questions.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		position: integer('position').notNull(),
		/** Opción esperada. Nunca se envía al navegador del participante. */
		isCorrect: integer('is_correct', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [index('question_options_question_idx').on(t.questionId, t.position)]
);

// ---------------------------------------------------------------
// Participantes, sesiones y respuestas
// ---------------------------------------------------------------

export const PARTICIPANT_SOURCES = ['cargado', 'abierto'] as const;

export const participants = sqliteTable(
	'participants',
	{
		id: id(),
		assessmentId: text('assessment_id')
			.notNull()
			.references(() => assessments.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Siempre en minúsculas y sin espacios. */
		email: text('email').notNull(),
		area: text('area'),
		cargo: text('cargo'),
		/** Campos adicionales del Excel de carga (JSON). */
		extra: text('extra', { mode: 'json' }).$type<Record<string, string>>(),
		source: text('source', { enum: PARTICIPANT_SOURCES }).notNull().default('cargado'),
		invitedAt: integer('invited_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('participants_assessment_email_uq').on(t.assessmentId, t.email)]
);

export const participantSessions = sqliteTable(
	'participant_sessions',
	{
		id: text('id').primaryKey(),
		participantId: text('participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(t) => [index('participant_sessions_participant_idx').on(t.participantId)]
);

/**
 * Una fila por participante (índice único): así la base garantiza una sola entrega.
 * `submittedAt` nulo = en progreso (borrador); con valor = entregado.
 */
export const submissions = sqliteTable(
	'submissions',
	{
		id: id(),
		participantId: text('participant_id')
			.notNull()
			.unique()
			.references(() => participants.id, { onDelete: 'cascade' }),
		assessmentId: text('assessment_id')
			.notNull()
			.references(() => assessments.id, { onDelete: 'cascade' }),
		startedAt: createdAt(),
		submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch('subsec') * 1000)`)
	},
	(t) => [index('submissions_assessment_idx').on(t.assessmentId)]
);

export const answers = sqliteTable(
	'answers',
	{
		id: id(),
		submissionId: text('submission_id')
			.notNull()
			.references(() => submissions.id, { onDelete: 'cascade' }),
		questionId: text('question_id')
			.notNull()
			.references(() => questions.id, { onDelete: 'cascade' }),
		optionId: text('option_id').references(() => questionOptions.id, { onDelete: 'set null' }),
		text: text('text'),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch('subsec') * 1000)`)
	},
	(t) => [
		uniqueIndex('answers_submission_question_uq').on(t.submissionId, t.questionId),
		index('answers_question_idx').on(t.questionId)
	]
);

// ---------------------------------------------------------------
// Análisis con IA
// ---------------------------------------------------------------

export const AI_SCOPES = ['pregunta', 'global'] as const;

export const aiAnalyses = sqliteTable(
	'ai_analyses',
	{
		id: id(),
		assessmentId: text('assessment_id')
			.notNull()
			.references(() => assessments.id, { onDelete: 'cascade' }),
		/** Nulo cuando el análisis es global (todas las preguntas abiertas). */
		questionId: text('question_id').references(() => questions.id, { onDelete: 'cascade' }),
		scope: text('scope', { enum: AI_SCOPES }).notNull(),
		model: text('model').notNull(),
		/** Resultado estructurado (JSON validado con Zod). */
		result: text('result', { mode: 'json' }).notNull(),
		/** Hash de las respuestas analizadas: permite saber si hay respuestas nuevas. */
		inputHash: text('input_hash').notNull(),
		responseCount: integer('response_count').notNull(),
		createdById: text('created_by_id').references(() => adminUsers.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('ai_analyses_assessment_idx').on(t.assessmentId, t.questionId)]
);

// ---------------------------------------------------------------
// Seguridad y auditoría
// ---------------------------------------------------------------

/**
 * Contador de intentos fallidos para rate limiting.
 * `key` combina ámbito y sujeto, ej. "admin-login:ip:1.2.3.4" o "acceso:email:x@y.com".
 */
export const authAttempts = sqliteTable('auth_attempts', {
	key: text('key').primaryKey(),
	failures: integer('failures').notNull().default(0),
	windowStart: integer('window_start', { mode: 'timestamp_ms' }).notNull(),
	lockedUntil: integer('locked_until', { mode: 'timestamp_ms' })
});

export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		adminId: text('admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),
		action: text('action').notNull(),
		entityType: text('entity_type'),
		entityId: text('entity_id'),
		metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
		ip: text('ip'),
		createdAt: createdAt()
	},
	(t) => [index('audit_log_created_idx').on(t.createdAt)]
);

export const EMAIL_STATUSES = ['enviado', 'error'] as const;

export const emailLog = sqliteTable(
	'email_log',
	{
		id: id(),
		participantId: text('participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		status: text('status', { enum: EMAIL_STATUSES }).notNull(),
		error: text('error'),
		sentById: text('sent_by_id').references(() => adminUsers.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('email_log_participant_idx').on(t.participantId)]
);
