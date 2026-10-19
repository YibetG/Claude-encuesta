import { fail } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { requireAssessment } from '#lib/server/route-helpers.ts';
import {
	addParticipant,
	deleteParticipant,
	distinctAreasAndCargos,
	listParticipants,
	ParticipantExistsError,
	ParticipantHasResponsesError,
	participantCounts,
	upsertParticipants
} from '#lib/server/services/participants.ts';
import { PARTICIPANT_STATUSES, participantSchema } from '#lib/schemas/participant.ts';
import { fieldErrors } from '#lib/schemas/assessment.ts';
import { ImportFileError, readTable } from '#lib/server/import/table.ts';
import { parseParticipantRows } from '#lib/server/import/participants-import.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	requireAssessment(params.id);
	const all = listParticipants(db, params.id);

	const estado = url.searchParams.get('estado') ?? '';
	const area = url.searchParams.get('area') ?? '';
	const cargo = url.searchParams.get('cargo') ?? '';
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

	const filtered = all.filter(
		(p) =>
			(!estado || p.status === estado) &&
			(!area || p.area === area) &&
			(!cargo || p.cargo === cargo) &&
			(!q || p.name.toLowerCase().includes(q) || p.email.includes(q))
	);

	return {
		participants: filtered,
		counts: participantCounts(all),
		filters: { estado, area, cargo, q },
		statuses: PARTICIPANT_STATUSES,
		...distinctAreasAndCargos(db, params.id)
	};
};

export const actions: Actions = {
	agregar: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const form = await request.formData();
		const values = {
			name: String(form.get('name') ?? ''),
			email: String(form.get('email') ?? ''),
			area: String(form.get('area') ?? ''),
			cargo: String(form.get('cargo') ?? '')
		};
		const parsed = participantSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { addValues: values, addErrors: fieldErrors(parsed.error) });
		}
		try {
			addParticipant(db, params.id, parsed.data, locals.admin!.id, getClientAddress());
		} catch (e) {
			if (e instanceof ParticipantExistsError) {
				const addErrors: Record<string, string> = { email: e.message };
				return fail(409, { addValues: values, addErrors });
			}
			throw e;
		}
		return { added: parsed.data.email };
	},

	importar: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const file = (await request.formData()).get('archivo');
		if (!(file instanceof File)) return fail(400, { importErrors: ['Seleccione un archivo.'] });

		let result;
		try {
			result = parseParticipantRows(await readTable(file));
		} catch (e) {
			if (e instanceof ImportFileError) return fail(400, { importErrors: [e.message] });
			throw e;
		}
		if (!result.ok) return fail(400, { importErrors: result.errors });

		const counts = upsertParticipants(
			db,
			params.id,
			result.participants,
			locals.admin!.id,
			getClientAddress()
		);
		return { imported: counts };
	},

	eliminar: async ({ request, params, locals, getClientAddress }) => {
		requireAssessment(params.id);
		const id = String((await request.formData()).get('participantId') ?? '');
		try {
			const ok = deleteParticipant(db, params.id, id, locals.admin!.id, getClientAddress());
			if (!ok) return fail(404, { deleteError: 'El participante no existe.' });
		} catch (e) {
			if (e instanceof ParticipantHasResponsesError) return fail(409, { deleteError: e.message });
			throw e;
		}
		return { deleted: true };
	}
};
