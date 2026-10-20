import { ACCESS_PASSWORD_KEY, DATABASE_URL } from '$app/env/private';
import { createDb } from './client';
import { configureSecretKey } from '../security/secret-box';

/** Conexión única a la base, compartida por todas las peticiones. */
export const db = createDb(DATABASE_URL);

// Clave para cifrar/descifrar las contraseñas de acceso (ver security/secret-box.ts).
configureSecretKey({ envKey: ACCESS_PASSWORD_KEY, dbUrl: DATABASE_URL });
