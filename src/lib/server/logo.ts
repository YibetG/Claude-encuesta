import type { Assessment } from './services/assessments';

/**
 * URL pública del logo de un assessment, o `null` si no tiene. Lleva la fecha de
 * actualización como versión para que el navegador pueda guardarlo en caché.
 */
export function logoUrl(a: Pick<Assessment, 'slug' | 'logoMime' | 'logoUpdatedAt'>): string | null {
	if (!a.logoMime || !a.logoUpdatedAt) return null;
	return `/a/${a.slug}/logo?v=${a.logoUpdatedAt.getTime()}`;
}
