import { z } from 'zod';

export const emailSchema = z
	.string({ error: 'Escriba un email.' })
	.trim()
	.toLowerCase()
	.max(254, 'El email es demasiado largo.')
	.pipe(z.email('Escriba un email válido.'));

export const loginSchema = z.object({
	email: emailSchema,
	// En el login no se exige la política de longitud: solo se compara con el hash.
	password: z
		.string({ error: 'Escriba la contraseña.' })
		.min(1, 'Escriba la contraseña.')
		.max(200, 'La contraseña es demasiado larga.')
});

/** Política de contraseñas de administrador. */
export const adminPasswordSchema = z
	.string()
	.min(10, 'La contraseña debe tener al menos 10 caracteres.')
	.max(200, 'La contraseña es demasiado larga.');

export const createAdminSchema = z.object({
	email: emailSchema,
	name: z.string().trim().min(2, 'El nombre es muy corto.').max(100, 'El nombre es muy largo.'),
	password: adminPasswordSchema
});

export type CreateAdminInput = z.infer<typeof createAdminSchema>;
