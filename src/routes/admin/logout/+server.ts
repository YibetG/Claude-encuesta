import { redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import {
	ADMIN_SESSION_COOKIE,
	deleteAdminSessionCookie,
	invalidateAdminSession
} from '#lib/server/auth/admin-session.ts';
import { audit } from '#lib/server/security/audit.ts';
import type { RequestHandler } from './$types';

// Solo POST: un GET (ej. un <img src="/admin/logout">) no debe poder cerrar la sesión.
export const POST: RequestHandler = ({ cookies, locals, getClientAddress }) => {
	const token = cookies.get(ADMIN_SESSION_COOKIE);
	if (token) invalidateAdminSession(db, token);
	if (locals.admin)
		audit(db, { adminId: locals.admin.id, action: 'admin.logout', ip: getClientAddress() });
	deleteAdminSessionCookie(cookies);
	redirect(303, '/admin/login');
};
