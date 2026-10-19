import { fail } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { reportFiltersFromUrl, requireAssessment } from '#lib/server/route-helpers.ts';
import { buildReport } from '#lib/server/services/reports.ts';
import { latestAnalyses } from '#lib/server/services/ai-store.ts';
import { analyzeGlobal, analyzeQuestion } from '#lib/server/services/ai-analysis.ts';
import { aiModel, getAnalyzer } from '#lib/server/ai/index.ts';
import { AiError } from '#lib/server/ai/client.ts';
import type { StoredAnalysis } from '#lib/ai-analysis.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const a = requireAssessment(params.id);
	const { filters, areas, cargos } = reportFiltersFromUrl(a.id, url);
	// Las respuestas por participante solo se usan en las exportaciones: no se envían al navegador.
	const report = { ...buildReport(db, a.id, filters), answersByParticipant: {} };

	const analyses: Record<string, StoredAnalysis> = Object.fromEntries(latestAnalyses(db, a.id));
	return {
		report,
		areas,
		cargos,
		query: url.search,
		analyses,
		ai: { configured: getAnalyzer() !== null, model: aiModel }
	};
};

/** Ejecuta un análisis y traduce los errores a un mensaje para la pantalla. */
async function runAnalysis(target: string, fn: () => Promise<{ cached: boolean }>) {
	try {
		const { cached } = await fn();
		return { aiDone: target, cached };
	} catch (e) {
		if (e instanceof AiError) return fail(502, { aiError: e.message, target });
		throw e;
	}
}

export const actions: Actions = {
	analizar: async ({ request, params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		const analyzer = getAnalyzer();
		const form = await request.formData();
		const questionId = String(form.get('questionId') ?? '');
		if (!analyzer) {
			return fail(400, {
				aiError: 'Configure ANTHROPIC_API_KEY en .env para usar la IA.',
				target: questionId
			});
		}
		return runAnalysis(questionId, () =>
			analyzeQuestion(db, analyzer, {
				assessmentId: a.id,
				questionId,
				adminId: locals.admin!.id,
				force: form.get('force') === '1',
				ip: getClientAddress()
			})
		);
	},

	analizarGlobal: async ({ request, params, locals, getClientAddress }) => {
		const a = requireAssessment(params.id);
		const analyzer = getAnalyzer();
		if (!analyzer) {
			return fail(400, {
				aiError: 'Configure ANTHROPIC_API_KEY en .env para usar la IA.',
				target: 'global'
			});
		}
		const form = await request.formData();
		return runAnalysis('global', () =>
			analyzeGlobal(db, analyzer, {
				assessmentId: a.id,
				adminId: locals.admin!.id,
				force: form.get('force') === '1',
				ip: getClientAddress()
			})
		);
	}
};
