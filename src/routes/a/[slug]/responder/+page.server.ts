import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { requireParticipant } from '#lib/server/participant-route.ts';
import {
	AlreadySubmittedError,
	getAnswers,
	listQuestionsForParticipant,
	readAnswerFields,
	saveAnswers,
	submitAnswers
} from '#lib/server/services/answers.ts';
import { deleteParticipantCookie } from '#lib/server/auth/participant-session.ts';
import { participantBrand } from '#lib/server/logo.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, cookies }) => {
	const ctx = requireParticipant(cookies, params.slug);
	const a = ctx.assessment;
	return {
		assessment: {
			title: a.title,
			instructions: a.instructions,
			openMaxChars: a.openMaxChars,
			endsAt: a.endsAt,
			timezone: a.timezone,
			...participantBrand(db, a)
		},
		participant: { name: ctx.participant.name, email: ctx.participant.email },
		// Sin la opción correcta (ver listQuestionsForParticipant).
		questions: listQuestionsForParticipant(db, a.id),
		answers: getAnswers(db, ctx.submission.id),
		savedAt: ctx.submission.updatedAt
	};
};

export const actions: Actions = {
	/** Autoguardado (y botón "Guardar" sin JavaScript). */
	guardar: async ({ request, params, cookies }) => {
		const ctx = requireParticipant(cookies, params.slug);
		const entries = readAnswerFields(await request.formData());
		try {
			const r = saveAnswers(db, ctx, entries);
			if (!r.ok) return fail(400, { errors: r.errors, missing: [] as number[] });
		} catch (e) {
			if (e instanceof AlreadySubmittedError) redirect(303, `/a/${params.slug}/entregado`);
			throw e;
		}
		return { savedAt: new Date() };
	},

	/** Entrega final: guarda lo que venga en el formulario y luego entrega. */
	entregar: async ({ request, params, cookies }) => {
		const ctx = requireParticipant(cookies, params.slug);
		try {
			const saved = saveAnswers(db, ctx, readAnswerFields(await request.formData()));
			if (!saved.ok) return fail(400, { errors: saved.errors, missing: [] as number[] });

			const r = submitAnswers(db, ctx);
			if (!r.ok) {
				const list = r.missing.join(', ');
				return fail(400, {
					missing: r.missing,
					errors: [
						r.missing.length === 1
							? `Falta responder la pregunta obligatoria ${list}.`
							: `Faltan preguntas obligatorias por responder: ${list}.`
					]
				});
			}
		} catch (e) {
			if (!(e instanceof AlreadySubmittedError)) throw e;
		}
		deleteParticipantCookie(cookies, params.slug);
		redirect(303, `/a/${params.slug}/entregado`);
	}
};
