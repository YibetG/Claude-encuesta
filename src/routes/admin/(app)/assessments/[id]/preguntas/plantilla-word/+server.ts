import { buildWordTemplate } from '#lib/server/import/word-template.ts';
import type { RequestHandler } from './$types';

/** Plantilla Word para importar preguntas. */
export const GET: RequestHandler = () => {
	return new Response(new Uint8Array(buildWordTemplate()), {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'Content-Disposition': 'attachment; filename="plantilla-preguntas.docx"'
		}
	});
};
