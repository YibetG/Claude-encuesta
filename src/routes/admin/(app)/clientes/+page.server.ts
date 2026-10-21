import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { clientSchema } from '#lib/schemas/assessment.ts';
import { clientNameTaken, createClient, listClients } from '#lib/server/services/clients.ts';
import { clientLogoUrl } from '#lib/server/logo.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	clients: listClients(db).map((c) => ({ ...c, logoUrl: clientLogoUrl(c) }))
});

export const actions: Actions = {
	crear: async ({ request, locals, getClientAddress }) => {
		const name = String((await request.formData()).get('name') ?? '');
		const parsed = clientSchema.safeParse({ name });
		if (!parsed.success) return fail(400, { name, error: parsed.error.issues[0].message });
		if (clientNameTaken(db, parsed.data.name)) {
			return fail(400, { name, error: 'Ya existe un cliente con ese nombre.' });
		}
		const client = createClient(db, parsed.data.name, locals.admin!.id, getClientAddress());
		redirect(303, `/admin/clientes/${client.id}?creado=1`);
	}
};
