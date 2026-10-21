import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { getAssessmentBySlug } from '#lib/server/services/access.ts';
import { readClientLogo } from '#lib/server/services/clients.ts';
import type { RequestHandler } from './$types';

/**
 * Logo del cliente de un assessment (público: aparece en la pantalla de ingreso).
 * Igual que la pantalla de ingreso, un borrador se trata como inexistente.
 */
export const GET: RequestHandler = ({ params, url }) => {
	const a = getAssessmentBySlug(db, params.slug);
	const logo = a && a.status !== 'borrador' ? readClientLogo(db, a.clientId) : undefined;
	if (!logo) error(404, 'Sin logo');

	return new Response(new Uint8Array(logo.data), {
		headers: {
			// El tipo se detectó por el contenido al subirlo (solo PNG, JPEG o WebP).
			'Content-Type': logo.mime,
			// Si alguien abre la imagen directamente, no puede ejecutar nada.
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
			'Cache-Control': url.searchParams.has('v')
				? 'public, max-age=31536000, immutable'
				: 'no-cache'
		}
	});
};
