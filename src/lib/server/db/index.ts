import { DATABASE_URL } from '$app/env/private';
import { createDb } from './client';

/** Conexión única a la base, compartida por todas las peticiones. */
export const db = createDb(DATABASE_URL);
