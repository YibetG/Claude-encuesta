import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { assertUuid } from '#lib/server/forms.ts';
import { readClientLogo } from '#lib/server/services/clients.ts';
import type { RequestHandler } from './$types';

/** Logo de un cliente para la administración (el hook exige sesión de admin en /admin). */
export const GET: RequestHandler = ({ params }) => {
	assertUuid(params.id);
	const logo = readClientLogo(db, params.id);
	if (!logo) error(404, 'Sin logo');
	return new Response(new Uint8Array(logo.data), {
		headers: {
			'Content-Type': logo.mime,
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
		}
	});
};
