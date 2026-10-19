import { fail, redirect } from '@sveltejs/kit';
import { ADMIN_SESSION_HOURS } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { loginSchema } from '#lib/schemas/admin.ts';
import { authenticateAdmin } from '#lib/server/services/admin-auth.ts';
import {
	createAdminSession,
	deleteExpiredAdminSessions,
	setAdminSessionCookie
} from '#lib/server/auth/admin-session.ts';
import { safeAdminRedirect } from '#lib/server/auth/redirect.ts';
import { lockMessage } from '#lib/server/security/rate-limit.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.admin) redirect(303, safeAdminRedirect(url.searchParams.get('destino')));
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const parsed = loginSchema.safeParse({ email, password: form.get('password') });

		if (!parsed.success) {
			return fail(400, { email, error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' });
		}

		const result = await authenticateAdmin(db, { ...parsed.data, ip: getClientAddress() });

		if (!result.ok) {
			return result.reason === 'locked'
				? fail(429, { email, error: lockMessage(result.until) })
				: fail(400, { email, error: 'Email o contraseña incorrectos.' });
		}

		deleteExpiredAdminSessions(db);
		const { token, expiresAt } = createAdminSession(db, result.admin.id, ADMIN_SESSION_HOURS);
		setAdminSessionCookie(cookies, token, expiresAt);

		redirect(303, safeAdminRedirect(url.searchParams.get('destino')));
	}
};
