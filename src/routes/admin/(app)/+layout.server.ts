import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// hooks.server.ts ya protege /admin; esta verificación es una segunda barrera
// y entrega los datos del admin a todas las páginas del panel.
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.admin) redirect(303, `/admin/login?destino=${encodeURIComponent(url.pathname)}`);
	return { admin: locals.admin };
};
