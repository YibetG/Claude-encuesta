import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiOutputSchema, normalizeAnalysis, type AiAnalysis } from '../../ai-analysis';
import { SYSTEM_PROMPT } from './prompts';

/** Error con un mensaje en español listo para mostrar al administrador. */
export class AiError extends Error {}

/** Lo que el servicio necesita de la IA. Permite usar un cliente simulado en las pruebas. */
export interface Analyzer {
	readonly model: string;
	analyze(userPrompt: string): Promise<AiAnalysis>;
}

// Modelos que aceptan el respaldo automático del servidor ante una negativa (refusal).
const FALLBACK_MODELS = new Set([
	'claude-fable-5-1',
	'claude-opus-5-5',
	'claude-opus-5',
	'claude-sonnet-5-5'
]);

/**
 * Cliente real de Anthropic. Solo se usa en el servidor: la API key nunca llega al navegador.
 * - Salida estructurada validada con Zod (`betaZodOutputFormat`).
 * - Esfuerzo "medium": buen equilibrio entre calidad y costo para resumir texto.
 * - Respaldo automático del servidor si el modelo declina la solicitud (fallbacks: "default").
 */
export function createAnthropicAnalyzer(opts: {
	apiKey: string;
	model: string;
	timeoutMs: number;
}): Analyzer {
	const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 2 });
	const withFallback = FALLBACK_MODELS.has(opts.model);

	return {
		model: opts.model,
		async analyze(userPrompt) {
			let response;
			try {
				response = await client.beta.messages.parse({
					model: opts.model,
					max_tokens: 16000,
					system: SYSTEM_PROMPT,
					messages: [{ role: 'user', content: userPrompt }],
					output_config: { effort: 'medium', format: betaZodOutputFormat(aiOutputSchema) },
					...(withFallback
						? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
						: {})
				});
			} catch (e) {
				throw toAiError(e);
			}

			if (response.stop_reason === 'refusal') {
				throw new AiError(
					'La IA no pudo analizar este contenido. Revise las respuestas o intente más tarde.'
				);
			}
			if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
				throw new AiError('La IA devolvió una respuesta incompleta. Intente de nuevo.');
			}
			return normalizeAnalysis(response.parsed_output);
		}
	};
}

/** Traduce los errores del SDK (clases tipadas, sin comparar textos) a mensajes claros. */
export function toAiError(e: unknown): AiError {
	if (e instanceof AiError) return e;
	if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
		return new AiError(
			'La API key de Anthropic no es válida o no tiene permisos. Revise ANTHROPIC_API_KEY.'
		);
	}
	if (e instanceof Anthropic.NotFoundError) {
		return new AiError('El modelo configurado en ANTHROPIC_MODEL no existe o no está disponible.');
	}
	if (e instanceof Anthropic.RateLimitError) {
		return new AiError('Se alcanzó el límite de uso de la IA. Intente de nuevo en unos minutos.');
	}
	if (e instanceof Anthropic.BadRequestError) {
		console.error('[ia] solicitud rechazada', e.message);
		return new AiError('La solicitud a la IA fue rechazada. Revise la configuración del modelo.');
	}
	if (e instanceof Anthropic.APIConnectionTimeoutError) {
		return new AiError(
			'La IA tardó demasiado en responder. Intente de nuevo; si persiste, aumente AI_TIMEOUT_MS.'
		);
	}
	if (e instanceof Anthropic.APIConnectionError) {
		return new AiError('No se pudo conectar con el servicio de IA. Revise la conexión a internet.');
	}
	if (e instanceof Anthropic.APIError) {
		return new AiError('El servicio de IA no está disponible en este momento. Intente más tarde.');
	}
	console.error('[ia] error inesperado', e);
	return new AiError('Ocurrió un error inesperado al analizar con IA.');
}
