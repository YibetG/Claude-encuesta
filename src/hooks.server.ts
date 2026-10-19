import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { sequence } from '@sveltejs/kit/hooks';
import { ADMIN_SESSION_HOURS } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { scheduleMaintenance } from '#lib/server/maintenance.ts';

/** Al iniciar el servidor: limpieza de sesiones vencidas e intentos antiguos (y luego cada hora). */
export const init: ServerInit = () => {
	scheduleMaintenance(db);
};
import { applySecurityHeaders } from '#lib/server/security/headers.ts';
import {
	ADMIN_SESSION_COOKIE,
	deleteAdminSessionCookie,
	setAdminSessionCookie,
	validateAdminSession
} from '#lib/server/auth/admin-session.ts';

/** Encabezados de seguridad en todas las respuestas. */
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	applySecurityHeaders(response.headers, event.url);
	return response;
};

/** Carga la sesión del administrador (si hay cookie) y renueva su vencimiento. */
const adminSession: Handle = async ({ event, resolve }) => {
	event.locals.admin = null;

	const token = event.cookies.get(ADMIN_SESSION_COOKIE);
	if (token) {
		const session = validateAdminSession(db, token, ADMIN_SESSION_HOURS);
		if (session) {
			event.locals.admin = session.admin;
			setAdminSessionCookie(event.cookies, token, session.expiresAt);
		} else {
			deleteAdminSessionCookie(event.cookies);
		}
	}

	return resolve(event);
};

/**
 * Protege todo /admin salvo /admin/login. Se hace aquí (y no solo en el layout)
 * para cubrir también endpoints +server.ts como las descargas.
 */
const adminGuard: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isAdminArea = path === '/admin' || path.startsWith('/admin/');
	if (!isAdminArea) return resolve(event);

	if (!event.locals.admin && path !== '/admin/login') {
		const destino = path + event.url.search;
		// Respuesta explícita (no `redirect()` lanzado) para que también reciba los
		// encabezados de seguridad de `securityHeaders`.
		return new Response(null, {
			status: 303,
			headers: { location: `/admin/login?destino=${encodeURIComponent(destino)}` }
		});
	}

	const response = await resolve(event);
	// Las páginas de administración no deben quedar en caché (navegador ni proxies).
	response.headers.set('Cache-Control', 'no-store');
	return response;
};

export const handle = sequence(securityHeaders, adminSession, adminGuard);

/** Registra el error real en el servidor y muestra un mensaje genérico al usuario. */
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind === 'unknown') {
		console.error(`[error] ${event.request.method} ${event.url.pathname}`, error);
		return { message: 'Ocurrió un error inesperado. Intente de nuevo.' };
	}
};
