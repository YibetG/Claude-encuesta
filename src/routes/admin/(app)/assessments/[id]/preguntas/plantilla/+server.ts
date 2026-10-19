import { buildQuestionTemplate } from '#lib/server/import/questions-import.ts';
import type { RequestHandler } from './$types';

/** Plantilla Excel para importar preguntas. */
export const GET: RequestHandler = async () => {
	const body = await buildQuestionTemplate();
	return new Response(body, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': 'attachment; filename="plantilla-preguntas.xlsx"'
		}
	});
};
