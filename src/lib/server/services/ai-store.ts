import { desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { aiAnalyses } from '../db/schema';
import { aiAnalysisSchema, type StoredAnalysis } from '../../ai-analysis';

/**
 * Último análisis guardado por pregunta (clave = id de pregunta) y el global (clave "global").
 * Los registros que no cumplan el esquema actual se ignoran.
 */
export function latestAnalyses(db: DB, assessmentId: string): Map<string, StoredAnalysis> {
	const rows = db
		.select()
		.from(aiAnalyses)
		.where(eq(aiAnalyses.assessmentId, assessmentId))
		.orderBy(desc(aiAnalyses.createdAt))
		.all();

	const out = new Map<string, StoredAnalysis>();
	for (const r of rows) {
		const key = r.questionId ?? 'global';
		if (out.has(key)) continue;
		const parsed = aiAnalysisSchema.safeParse(r.result);
		if (!parsed.success) continue;
		out.set(key, {
			id: r.id,
			questionId: r.questionId,
			model: r.model,
			createdAt: r.createdAt,
			responseCount: r.responseCount,
			inputHash: r.inputHash,
			result: parsed.data
		});
	}
	return out;
}
