import { buildParticipantTemplate } from '#lib/server/import/participants-import.ts';
import type { RequestHandler } from './$types';

/** Plantilla Excel para cargar participantes. */
export const GET: RequestHandler = async () => {
	return new Response(await buildParticipantTemplate(), {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': 'attachment; filename="plantilla-participantes.xlsx"'
		}
	});
};
