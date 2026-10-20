import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { getAssessmentBySlug } from '#lib/server/services/access.ts';
import type { RequestHandler } from './$types';

/** Logo del cliente de un assessment (público: aparece en la pantalla de ingreso). */
export const GET: RequestHandler = ({ params, url }) => {
	const a = getAssessmentBySlug(db, params.slug);
	if (!a?.logoData || !a.logoMime) error(404, 'Sin logo');

	return new Response(new Uint8Array(a.logoData), {
		headers: {
			// El tipo se detectó por el contenido al subirlo (solo PNG, JPEG o WebP).
			'Content-Type': a.logoMime,
			// Si alguien abre la imagen directamente, no puede ejecutar nada.
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
			'Cache-Control': url.searchParams.has('v')
				? 'public, max-age=31536000, immutable'
				: 'no-cache'
		}
	});
};
