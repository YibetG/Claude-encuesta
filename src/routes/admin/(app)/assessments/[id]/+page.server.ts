import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import {
	accessPasswordSchema,
	assessmentFormSchema,
	fieldErrors
} from '#lib/schemas/assessment.ts';
import {
	duplicateAssessment,
	LOGO_MAX_BYTES,
	LogoError,
	publishProblems,
	revealAccessPassword,
	setAccessPassword,
	setLogo,
	setStatus,
	updateAssessment
} from '#lib/server/services/assessments.ts';
import { assessmentToForm, readAssessmentForm, timezoneOptions } from '#lib/server/forms.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const a = requireAssessment(params.id);
	return {
		values: assessmentToForm(a),
		timezones: timezoneOptions(),
		publishProblems: publishProblems(db, a)
	};
};

export const actions: Actions = {
	guardar: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const values = readAssessmentForm(await request.formData());
		const parsed = assessmentFormSchema.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

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

	logo: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const file = (await request.formData()).get('logo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { logoError: 'Seleccione una imagen.' });
		}
		if (file.size > LOGO_MAX_BYTES)
			return fail(400, { logoError: 'El logo no puede superar 512 KB.' });
		try {
			setLogo(
				db,
				params.id,
				Buffer.from(await file.arrayBuffer()),
				locals.admin!.id,
				getClientAddress()
			);
		} catch (e) {
			if (e instanceof LogoError) return fail(400, { logoError: e.message });
			throw e;
		}
		return { logoSaved: true as const };
	},

	quitarLogo: ({ params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		setLogo(db, params.id, null, locals.admin!.id, getClientAddress());
		return { logoRemoved: true as const };
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

	duplicar: ({ params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const copy = duplicateAssessment(db, params.id, locals.admin!.id, getClientAddress());
		if (!copy) error(404, 'Assessment no encontrado');
		redirect(303, `/admin/assessments/${copy.id}?duplicado=1`);
	}
};
