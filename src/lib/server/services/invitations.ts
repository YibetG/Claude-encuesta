import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { assessments } from '../db/schema';
import { verifyPassword } from '../auth/password';
import { audit } from '../security/audit';
import type { Mailer } from '../email/mailer';
import type { Assessment } from './assessments';
import { listParticipants, recordEmailResults, type ParticipantRow } from './participants';
import { formatLongDateTime } from '../../format';
import {
	DEFAULT_INVITE_BODY,
	DEFAULT_INVITE_SUBJECT,
	renderGeneric,
	renderTemplate,
	textToHtml,
	type InviteVars
} from '../../invite-template';

export const RECIPIENT_MODES = ['sin_invitar', 'no_completados'] as const;
export type RecipientMode = (typeof RECIPIENT_MODES)[number];

export function getInviteTemplate(a: Assessment) {
	return {
		subject: a.inviteSubject || DEFAULT_INVITE_SUBJECT,
		body: a.inviteBody || DEFAULT_INVITE_BODY
	};
}

export function saveInviteTemplate(
	db: DB,
	assessmentId: string,
	tpl: { subject: string; body: string },
	adminId: string,
	ip?: string
) {
	db.update(assessments)
		.set({ inviteSubject: tpl.subject, inviteBody: tpl.body, updatedAt: new Date() })
		.where(eq(assessments.id, assessmentId))
		.run();
	audit(db, {
		adminId,
		action: 'assessment.editado',
		entityType: 'assessment',
		entityId: assessmentId,
		metadata: { cambio: 'plantilla de invitación' },
		ip
	});
}

export function publicLink(appUrl: string, slug: string) {
	return `${appUrl.replace(/\/$/, '')}/a/${slug}`;
}

/** Variables comunes a todos los destinatarios. */
export function baseVars(
	a: Assessment,
	password: string,
	appUrl: string
): Omit<InviteVars, 'nombre'> {
	return {
		titulo: a.title,
		descripcion: a.description,
		enlace: publicLink(appUrl, a.slug),
		contrasena: password,
		inicio: formatLongDateTime(a.startsAt, a.timezone),
		fin: formatLongDateTime(a.endsAt, a.timezone),
		zona_horaria: a.timezone.replaceAll('_', ' ')
	};
}

/**
 * La contraseña compartida solo existe como hash: para incluirla en el mensaje,
 * el admin la escribe y se verifica que coincida con la vigente.
 */
export async function checkAccessPassword(a: Assessment, password: string): Promise<boolean> {
	if (!a.accessPasswordHash || !password) return false;
	return verifyPassword(a.accessPasswordHash, password);
}

export function selectRecipients(list: ParticipantRow[], mode: RecipientMode): ParticipantRow[] {
	return list.filter((p) =>
		mode === 'sin_invitar' ? !p.invitedAt && p.status !== 'completado' : p.status !== 'completado'
	);
}

/** Mensaje genérico para copiar (WhatsApp, Teams, etc.). */
export function genericMessage(a: Assessment, password: string, appUrl: string) {
	const tpl = getInviteTemplate(a);
	const vars = baseVars(a, password, appUrl);
	return { subject: renderGeneric(tpl.subject, vars), body: renderGeneric(tpl.body, vars) };
}

/** Envía las invitaciones una por una y registra el resultado de cada correo. */
export async function sendInvitations(
	db: DB,
	mailer: Mailer,
	opts: {
		assessment: Assessment;
		mode: RecipientMode;
		password: string;
		appUrl: string;
		adminId: string;
		ip?: string;
	}
) {
	const { assessment: a } = opts;
	const recipients = selectRecipients(listParticipants(db, a.id), opts.mode);
	const tpl = getInviteTemplate(a);
	const vars = baseVars(a, opts.password, opts.appUrl);

	const results: { participantId: string; ok: boolean; error?: string }[] = [];
	for (const p of recipients) {
		const all = { ...vars, nombre: p.name };
		const text = renderTemplate(tpl.body, all);
		try {
			await mailer.send({
				to: p.email,
				subject: renderTemplate(tpl.subject, all),
				text,
				html: textToHtml(text)
			});
			results.push({ participantId: p.id, ok: true });
		} catch (e) {
			results.push({
				participantId: p.id,
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}

	recordEmailResults(db, results, opts.adminId);
	const sent = results.filter((r) => r.ok).length;
	const failed = results.length - sent;
	audit(db, {
		adminId: opts.adminId,
		action: 'invitaciones.enviadas',
		entityType: 'assessment',
		entityId: a.id,
		metadata: { enviados: sent, fallidos: failed, destinatarios: opts.mode, via: mailer.kind },
		ip: opts.ip
	});
	return { sent, failed, total: results.length };
}
