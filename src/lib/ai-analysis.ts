import { z } from 'zod';

// Estructura del análisis con IA de respuestas abiertas. Se valida con Zod lo que
// devuelve el modelo antes de guardarlo, y es lo que muestran la pantalla y el PDF.

export const FREQUENCIES = ['alta', 'media', 'baja'] as const;

export const aiAnalysisSchema = z.object({
	summary: z.string().min(1).max(4000),
	themes: z
		.array(
			z.object({
				name: z.string().min(1).max(200),
				description: z.string().max(1000),
				frequency: z.enum(FREQUENCIES),
				/** Cantidad aproximada de respuestas que tocan el tema. */
				approxCount: z.number().int().min(0)
			})
		)
		.max(15),
	highlights: z.array(z.string().max(600)).max(15),
	concerns: z.array(z.string().max(600)).max(15),
	quotes: z.array(z.string().max(400)).max(12)
});

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

export const FREQUENCY_LABELS: Record<(typeof FREQUENCIES)[number], string> = {
	alta: 'Alta',
	media: 'Media',
	baja: 'Baja'
};

/** Análisis guardado, como lo consumen la pantalla y las exportaciones. */
export type StoredAnalysis = {
	id: string;
	questionId: string | null;
	model: string;
	createdAt: Date;
	responseCount: number;
	result: AiAnalysis;
};
