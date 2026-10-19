import { z } from 'zod';
import { emailSchema } from './admin';

const optionalText = (max: number, label: string) =>
	z
		.string()
		.trim()
		.max(max, `${label}: máximo ${max} caracteres.`)
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.default(null);

export const participantSchema = z.object({
	name: z
		.string({ error: 'Escriba el nombre.' })
		.trim()
		.min(2, 'El nombre debe tener al menos 2 caracteres.')
		.max(150, 'El nombre no puede superar 150 caracteres.'),
	email: emailSchema,
	area: optionalText(100, 'Área'),
	cargo: optionalText(100, 'Cargo'),
	extra: z.record(z.string(), z.string().max(500)).nullable().default(null)
});

export type ParticipantInput = z.output<typeof participantSchema>;

export const PARTICIPANT_STATUSES = ['pendiente', 'en_progreso', 'completado'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
	pendiente: 'Pendiente',
	en_progreso: 'En progreso',
	completado: 'Completado'
};
