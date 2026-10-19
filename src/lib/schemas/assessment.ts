import { z } from 'zod';
import { isValidTimeZone, parseLocalDateTime } from '../datetime';
import { ACCESS_MODES } from '../constants';

const text = (max: number, label: string) =>
	z
		.string()
		.trim()
		.max(max, `${label}: máximo ${max.toLocaleString('es-CO')} caracteres.`);

/**
 * Formulario de datos generales del assessment. Las fechas llegan como texto
 * de <input type="datetime-local"> y se convierten a UTC según la zona elegida.
 */
export const assessmentFormSchema = z
	.object({
		title: text(200, 'Título').min(3, 'El título debe tener al menos 3 caracteres.'),
		description: text(5000, 'Descripción').default(''),
		instructions: text(10000, 'Instrucciones').default(''),
		timezone: z.string().trim().refine(isValidTimeZone, 'Zona horaria no válida.'),
		startsAt: z.string().min(1, 'Indique la fecha y hora de inicio.'),
		endsAt: z.string().min(1, 'Indique la fecha y hora de finalización.'),
		accessMode: z.enum(ACCESS_MODES, { error: 'Modo de acceso no válido.' }),
		openMaxChars: z.coerce
			.number({ error: 'El límite de caracteres debe ser un número.' })
			.int('El límite de caracteres debe ser un número entero.')
			.min(500, 'El límite de caracteres debe ser al menos 500.')
			.max(50_000, 'El límite de caracteres no puede superar 50.000.')
	})
	.transform((v, ctx) => {
		const startsAt = parseLocalDateTime(v.startsAt, v.timezone);
		const endsAt = parseLocalDateTime(v.endsAt, v.timezone);
		if (!startsAt)
			ctx.addIssue({ code: 'custom', path: ['startsAt'], message: 'Fecha de inicio no válida.' });
		if (!endsAt)
			ctx.addIssue({
				code: 'custom',
				path: ['endsAt'],
				message: 'Fecha de finalización no válida.'
			});
		if (!startsAt || !endsAt) return z.NEVER;
		if (endsAt <= startsAt) {
			ctx.addIssue({
				code: 'custom',
				path: ['endsAt'],
				message: 'La finalización debe ser posterior al inicio.'
			});
			return z.NEVER;
		}
		return { ...v, startsAt, endsAt };
	});

export type AssessmentFormInput = z.output<typeof assessmentFormSchema>;

/** Contraseña compartida de acceso al assessment. */
export const accessPasswordSchema = z
	.object({
		password: z
			.string()
			.min(8, 'La contraseña de acceso debe tener al menos 8 caracteres.')
			.max(100, 'La contraseña de acceso es demasiado larga.'),
		confirm: z.string()
	})
	.refine((v) => v.password === v.confirm, {
		path: ['confirm'],
		message: 'Las contraseñas no coinciden.'
	});

/** Convierte los errores de Zod en un mapa campo → primer mensaje. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
	const out: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = String(issue.path[0] ?? '_');
		out[key] ??= issue.message;
	}
	return out;
}
