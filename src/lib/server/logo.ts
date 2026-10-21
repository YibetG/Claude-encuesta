import type { Executor } from './db/client';
import { getBrand, type Brand } from './services/clients';
import { themeStyle } from '../theme';

/**
 * URL pública del logo que ve el participante (el del cliente del assessment), o `null`.
 * Lleva la fecha de actualización como versión para que el navegador pueda guardarlo en caché.
 */
export function logoUrl(slug: string, brand: Pick<Brand, 'logoMime' | 'logoUpdatedAt'> | null) {
	if (!brand?.logoMime || !brand.logoUpdatedAt) return null;
	return `/a/${slug}/logo?v=${brand.logoUpdatedAt.getTime()}`;
}

/** URL del logo en la administración (sirve también para clientes sin assessments). */
export function clientLogoUrl(c: Pick<Brand, 'id' | 'logoMime' | 'logoUpdatedAt'>) {
	if (!c.logoMime || !c.logoUpdatedAt) return null;
	return `/admin/clientes/${c.id}/logo?v=${c.logoUpdatedAt.getTime()}`;
}

/** Logo y colores para las pantallas del participante de un assessment. */
export function participantBrand(db: Executor, a: { slug: string; clientId: string | null }) {
	const brand = getBrand(db, a.clientId);
	return {
		logoUrl: logoUrl(a.slug, brand),
		themeStyle: themeStyle({ primary: brand?.themePrimary, accent: brand?.themeAccent }) ?? null
	};
}
