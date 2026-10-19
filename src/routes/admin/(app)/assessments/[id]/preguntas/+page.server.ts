import { fail } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import {
	listQuestionsForAdmin,
	QuestionsLockedError,
	replaceQuestions,
	toQuestionInputs
} from '#lib/server/services/questions.ts';
import { MAX_QUESTIONS, questionIssues, questionListSchema } from '#lib/schemas/question.ts';
import { ImportFileError, readTable } from '#lib/server/import/table.ts';
import { parseQuestionRows } from '#lib/server/import/questions-import.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	requireAssessment(params.id);
	return { questions: listQuestionsForAdmin(db, params.id) };
};

/** Guarda la lista, traduciendo el bloqueo por respuestas a un error 409 legible. */
function save(
	assessmentId: string,
	list: Parameters<typeof replaceQuestions>[2],
	adminId: string,
	opts: Parameters<typeof replaceQuestions>[4]
) {
	try {
		replaceQuestions(db, assessmentId, list, adminId, opts);
		return null;
	} catch (e) {
		if (e instanceof QuestionsLockedError) return fail(409, { errors: [e.message] });
		throw e;
	}
}

export const actions: Actions = {
	guardar: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const form = await request.formData();

		let payload: unknown;
		try {
			payload = JSON.parse(String(form.get('payload') ?? '[]'));
		} catch {
			return fail(400, { errors: ['No se pudieron leer las preguntas enviadas.'] });
		}

		const parsed = questionListSchema.safeParse(payload);
		if (!parsed.success) return fail(400, { errors: questionIssues(parsed.error) });

		const failed = save(params.id, parsed.data, locals.admin!.id, { ip: getClientAddress() });
		if (failed) return failed;
		return { saved: parsed.data.length };
	},

	importar: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const form = await request.formData();
		const file = form.get('archivo');
		const modo = form.get('modo') === 'reemplazar' ? 'reemplazar' : 'agregar';

		if (!(file instanceof File)) return fail(400, { importErrors: ['Seleccione un archivo.'] });

		let result;
		try {
			result = parseQuestionRows(await readTable(file));
		} catch (e) {
			if (e instanceof ImportFileError) return fail(400, { importErrors: [e.message] });
			throw e;
		}
		if (!result.ok) return fail(400, { importErrors: result.errors });

		const existing =
			modo === 'agregar' ? toQuestionInputs(listQuestionsForAdmin(db, params.id)) : [];
		const all = [...existing, ...result.questions];
		if (all.length > MAX_QUESTIONS) {
			return fail(400, {
				importErrors: [`El total superaría el máximo de ${MAX_QUESTIONS} preguntas.`]
			});
		}

		const failed = save(params.id, all, locals.admin!.id, {
			action: 'preguntas.importadas',
			ip: getClientAddress()
		});
		if (failed) return fail(409, { importErrors: failed.data.errors });
		return { imported: result.questions.length, modo };
	}
};
