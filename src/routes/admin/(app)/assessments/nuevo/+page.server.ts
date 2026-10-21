import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { assessmentFormSchema, fieldErrors } from '#lib/schemas/assessment.ts';
import { createAssessment } from '#lib/server/services/assessments.ts';
import { clientExists, clientOptions } from '#lib/server/services/clients.ts';
import { readAssessmentForm, timezoneOptions } from '#lib/server/forms.ts';
import { DEFAULT_TIMEZONE } from '#lib/format.ts';
import { toLocalDateTimeInput } from '#lib/datetime.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	// Valores sugeridos: empieza mañana a las 8:00 y dura una semana.
	const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
	const start = toLocalDateTimeInput(tomorrow, DEFAULT_TIMEZONE).slice(0, 10) + 'T08:00';
	const end =
		toLocalDateTimeInput(
			new Date(tomorrow.getTime() + 7 * 24 * 3600 * 1000),
			DEFAULT_TIMEZONE
		).slice(0, 10) + 'T18:00';

	// "Nuevo assessment" desde la ficha de un cliente llega con ?cliente=<id>.
	const preset = url.searchParams.get('cliente') ?? '';
	return {
		timezones: timezoneOptions(),
		clients: clientOptions(db),
		values: {
			title: '',
			clientId: preset && clientExists(db, preset) ? preset : '',
			description: '',
			instructions: '',
			timezone: DEFAULT_TIMEZONE,
			startsAt: start,
			endsAt: end,
			accessMode: 'invitados',
			openMaxChars: 8000
		}
	};
};

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		const values = readAssessmentForm(await request.formData());
		const parsed = assessmentFormSchema.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });
		if (parsed.data.clientId && !clientExists(db, parsed.data.clientId)) {
			return fail(400, { values, errors: { clientId: 'El cliente elegido no existe.' } });
		}

		const created = createAssessment(db, parsed.data, locals.admin!.id, getClientAddress());
		redirect(303, `/admin/assessments/${created.id}/preguntas?creado=1`);
	}
};
