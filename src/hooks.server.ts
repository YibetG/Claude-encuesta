import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { sequence } from '@sveltejs/kit/hooks';
import { applySecurityHeaders } from '#lib/server/security/headers.ts';

/** Encabezados de seguridad en todas las respuestas. */
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	applySecurityHeaders(response.headers, event.url);
	return response;
};

// Las sesiones de administrador y participante se agregan aquí en las fases 1 y 4.
export const handle = sequence(securityHeaders);

/** Registra el error real en el servidor y muestra un mensaje genérico al usuario. */
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind === 'unknown') {
		console.error(`[error] ${event.request.method} ${event.url.pathname}`, error);
		return { message: 'Ocurrió un error inesperado. Intente de nuevo.' };
	}
};
