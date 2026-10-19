import { AI_TIMEOUT_MS, ANTHROPIC_API_KEY, ANTHROPIC_MODEL } from '$app/env/private';
import { createAnthropicAnalyzer, type Analyzer } from './client';

let analyzer: Analyzer | null | undefined;

/** Cliente de IA configurado desde `.env`, o `null` si falta ANTHROPIC_API_KEY. */
export function getAnalyzer(): Analyzer | null {
	if (analyzer === undefined) {
		analyzer = ANTHROPIC_API_KEY
			? createAnthropicAnalyzer({
					apiKey: ANTHROPIC_API_KEY,
					model: ANTHROPIC_MODEL,
					timeoutMs: AI_TIMEOUT_MS
				})
			: null;
	}
	return analyzer;
}

export const aiModel = ANTHROPIC_MODEL;
