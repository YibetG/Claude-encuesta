import { fail } from '@sveltejs/kit';
import { APP_URL } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { mailer } from '#lib/server/email/index.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import { listParticipants } from '#lib/server/services/participants.ts';
import {
	baseVars,
	checkAccessPassword,
	genericMessage,
	getInviteTemplate,
	RECIPIENT_MODES,
	saveInviteTemplate,
	selectRecipients,
	sendInvitations,
	type RecipientMode
} from '#lib/server/services/invitations.ts';
import { INVITE_PLACEHOLDERS, inviteTemplateSchema } from '#lib/invite-template.ts';
import { fieldErrors } from '#lib/schemas/assessment.ts';
import type { Actions, PageServerLoad } from './$types';

const WRONG_PASSWORD = 'La contraseña no coincide con la contraseña de acceso vigente.';

export const load: PageServerLoad = ({ params }) => {
	const a = requireAssessment(params.id);
	const list = listParticipants(db, a.id);
	return {
		template: getInviteTemplate(a),
		placeholders: INVITE_PLACEHOLDERS,
		// Vista previa: la contraseña real no se conoce (solo su hash), se muestra un marcador.
		previewVars: {
			...baseVars(a, '(contraseña de acceso)', APP_URL),
			nombre: list[0]?.name ?? 'Ana Pérez'
		},
		recipientCounts: {
			sin_invitar: selectRecipients(list, 'sin_invitar').length,
			no_completados: selectRecipients(list, 'no_completados').length
		},
		mailerKind: mailer.kind
	};
};

export const actions: Actions = {
	plantilla: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const form = await request.formData();
		const values = {
			subject: String(form.get('subject') ?? ''),
			body: String(form.get('body') ?? '')
		};
		const parsed = inviteTemplateSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { templateValues: values, templateErrors: fieldErrors(parsed.error) });
		}
		saveInviteTemplate(db, params.id, parsed.data, locals.admin!.id, getClientAddress());
		return { templateSaved: true };
	},

	enviar: async ({ request, params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const modeRaw = String(form.get('destinatarios') ?? '');
		const mode: RecipientMode = (RECIPIENT_MODES as readonly string[]).includes(modeRaw)
			? (modeRaw as RecipientMode)
			: 'sin_invitar';

		if (a.status !== 'publicado') {
			return fail(400, { sendError: 'Publique el assessment antes de enviar invitaciones.' });
		}
		if (!(await checkAccessPassword(a, password))) return fail(400, { sendError: WRONG_PASSWORD });

		const result = await sendInvitations(db, mailer, {
			assessment: a,
			mode,
			password,
			appUrl: APP_URL,
			adminId: locals.admin!.id,
			ip: getClientAddress()
		});
		if (result.total === 0) {
			return fail(400, { sendError: 'No hay participantes que cumplan el criterio seleccionado.' });
		}
		return { sendResult: result };
	},

	copiar: async ({ request, params }) => {
		const a = requireAssessment(params.id);
		const password = String((await request.formData()).get('password') ?? '');
		if (!(await checkAccessPassword(a, password))) return fail(400, { copyError: WRONG_PASSWORD });
		return { generic: genericMessage(a, password, APP_URL) };
	}
};
