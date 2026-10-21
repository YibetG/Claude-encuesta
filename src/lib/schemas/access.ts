import { z } from 'zod';
import { emailSchema } from './admin';

/** Formulario de ingreso del participante. */
export const enterSchema = z.object({
	password: z
		.string({ error: 'Escriba la contraseña de acceso.' })
		.min(1, 'Escriba la contraseña de acceso.')
		.max(100, 'La contraseña es demasiado larga.'),
	email: emailSchema,
	name: z
		.string()
		.trim()
		.max(150, 'El nombre no puede superar 150 caracteres.')
		// El nombre se incluye en los correos: sin enlaces ni saltos de línea.
		.refine((v) => !/[\r\n]/.test(v), 'El nombre no puede tener saltos de línea.')
		.refine((v) => !/https?:\/\/|www\./i.test(v), 'El nombre no puede contener enlaces.')
		.transform((v) => (v === '' ? null : v))
		.refine((v) => v === null || v.length >= 2, 'El nombre debe tener al menos 2 caracteres.')
		.nullable()
		.default(null)
});
