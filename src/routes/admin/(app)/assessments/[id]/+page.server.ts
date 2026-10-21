import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import {
	accessPasswordSchema,
	assessmentFormSchema,
	fieldErrors
} from '#lib/schemas/assessment.ts';
import {
	countQuestions,
	deleteAssessment,
	deletionSummary,
	duplicateAssessment,
	publishProblems,
	revealAccessPassword,
	setAccessPassword,
	setStatus,
	updateAssessment
} from '#lib/server/services/assessments.ts';
import { clientExists, clientOptions } from '#lib/server/services/clients.ts';
import { createNextMeasurement } from '#lib/server/services/series.ts';
import { assessmentToForm, readAssessmentForm, timezoneOptions } from '#lib/server/forms.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const a = requireAssessment(params.id);
	return {
		values: assessmentToForm(a),
		timezones: timezoneOptions(),
		clients: clientOptions(db),
		publishProblems: publishProblems(db, a),
		deletion: deletionSummary(db, a.id)
	};
};

export const actions: Actions = {
	guardar: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const values = readAssessmentForm(await request.formData());
		const parsed = assessmentFormSchema.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });
		if (parsed.data.clientId && !clientExists(db, parsed.data.clientId)) {
			return fail(400, { values, errors: { clientId: 'El cliente elegido no existe.' } });
		}

		updateAssessment(db, params.id, parsed.data, locals.admin!.id, getClientAddress());
		return { saved: true as const };
	},

	password: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const form = await request.formData();
		const parsed = accessPasswordSchema.safeParse({
			password: form.get('password'),
			confirm: form.get('confirm')
		});
		if (!parsed.success) return fail(400, { passwordErrors: fieldErrors(parsed.error) });

		await setAccessPassword(
			db,
			params.id,
			parsed.data.password,
			locals.admin!.id,
			getClientAddress()
		);
		return { passwordSaved: true as const };
	},

	verPassword: ({ params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		const password = revealAccessPassword(db, a, locals.admin!.id, getClientAddress());
		if (password === null) {
			return fail(400, {
				revealError:
					'Esta contraseña se definió antes de poder consultarse. Defínala de nuevo para poder verla.'
			});
		}
		return { revealedPassword: password };
	},

	publicar: ({ params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		const problems = publishProblems(db, a);
		if (problems.length) return fail(400, { publishErrors: problems });
		setStatus(db, a, 'publicado', locals.admin!.id, getClientAddress());
		return { statusChanged: 'publicado' as const };
	},

	borrador: ({ params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		setStatus(db, a, 'borrador', locals.admin!.id, getClientAddress());
		return { statusChanged: 'borrador' as const };
	},

	archivar: ({ params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		setStatus(db, a, 'archivado', locals.admin!.id, getClientAddress());
		return { statusChanged: 'archivado' as const };
	},

	/** Borrado definitivo: exige escribir el título exacto como confirmación. */
	eliminar: async ({ request, params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		const typed = String((await request.formData()).get('confirmacion') ?? '').trim();
		if (typed !== a.title.trim()) {
			return fail(400, {
				deleteError: 'Escriba el título exacto del assessment para confirmar la eliminación.'
			});
		}
		deleteAssessment(db, a, locals.admin!.id, getClientAddress());
		redirect(303, '/admin?eliminado=1');
	},

	/** Siguiente medición de la serie (misma encuesta, para comparar antes y después). */
	medicion: ({ params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		if (countQuestions(db, a.id).total === 0) {
			return fail(400, { medicionError: 'Agregue preguntas antes de crear otra medición.' });
		}
		const next = createNextMeasurement(db, a.id, locals.admin!.id, getClientAddress());
		if (!next) error(404, 'Assessment no encontrado');
		redirect(303, `/admin/assessments/${next.id}?medicion=1`);
	},

	duplicar: ({ params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const copy = duplicateAssessment(db, params.id, locals.admin!.id, getClientAddress());
		if (!copy) error(404, 'Assessment no encontrado');
		redirect(303, `/admin/assessments/${copy.id}?duplicado=1`);
	}
};
