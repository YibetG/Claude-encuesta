import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { clientSchema, fieldErrors, themeSchema } from '#lib/schemas/assessment.ts';
import {
	ClientInUseError,
	clientNameTaken,
	deleteClient,
	LOGO_MAX_BYTES,
	LogoError,
	renameClient,
	setClientLogo,
	setClientTheme
} from '#lib/server/services/clients.ts';
import { listAssessments } from '#lib/server/services/assessments.ts';
import { requireClient } from '#lib/server/route-helpers.ts';
import { clientLogoUrl } from '#lib/server/logo.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const c = requireClient(params.id);
	return {
		// Sin la imagen: el logo se pide aparte.
		client: {
			id: c.id,
			name: c.name,
			themePrimary: c.themePrimary,
			themeAccent: c.themeAccent,
			logoUrl: clientLogoUrl(c)
		},
		assessments: listAssessments(db, { includeArchived: true, clientId: c.id })
	};
};

export const actions: Actions = {
	renombrar: async ({ request, params, locals, getClientAddress }) => {
		requireClient(params.id);
		const name = String((await request.formData()).get('name') ?? '');
		const parsed = clientSchema.safeParse({ name });
		if (!parsed.success) return fail(400, { name, nameError: parsed.error.issues[0].message });
		if (clientNameTaken(db, parsed.data.name, params.id)) {
			return fail(400, { name, nameError: 'Ya existe un cliente con ese nombre.' });
		}
		renameClient(db, params.id, parsed.data.name, locals.admin!.id, getClientAddress());
		return { renamed: true as const };
	},

	logo: async ({ request, params, locals, getClientAddress }) => {
		requireClient(params.id);
		const file = (await request.formData()).get('logo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { logoError: 'Seleccione una imagen.' });
		}
		if (file.size > LOGO_MAX_BYTES)
			return fail(400, { logoError: 'El logo no puede superar 2 MB.' });
		try {
			setClientLogo(
				db,
				params.id,
				Buffer.from(await file.arrayBuffer()),
				locals.admin!.id,
				getClientAddress()
			);
		} catch (e) {
			if (e instanceof LogoError) return fail(400, { logoError: e.message });
			throw e;
		}
		return { logoSaved: true as const };
	},

	quitarLogo: ({ params, locals, getClientAddress }) => {
		requireClient(params.id);
		setClientLogo(db, params.id, null, locals.admin!.id, getClientAddress());
		return { logoRemoved: true as const };
	},

	colores: async ({ request, params, locals, getClientAddress }) => {
		requireClient(params.id);
		const form = await request.formData();
		const values = {
			primary: String(form.get('primary') ?? ''),
			accent: String(form.get('accent') ?? '')
		};
		const parsed = themeSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { themeValues: values, themeErrors: fieldErrors(parsed.error) });
		}
		setClientTheme(db, params.id, parsed.data, locals.admin!.id, getClientAddress());
		return { themeSaved: true as const };
	},

	coloresPlataforma: ({ params, locals, getClientAddress }) => {
		requireClient(params.id);
		setClientTheme(db, params.id, null, locals.admin!.id, getClientAddress());
		return { themeReset: true as const };
	},

	eliminar: ({ params, locals, getClientAddress }) => {
		const client = requireClient(params.id);
		try {
			deleteClient(db, client, locals.admin!.id, getClientAddress());
		} catch (e) {
			if (e instanceof ClientInUseError) return fail(409, { deleteError: e.message });
			throw e;
		}
		redirect(303, '/admin/clientes?eliminado=1');
	}
};
