/**
 * Valida el parámetro `destino` del login para evitar redirecciones abiertas:
 * solo se aceptan rutas internas del panel (/admin...). Cualquier otra cosa
 * (URLs absolutas, "//otro-sitio", "/\\otro-sitio") vuelve al inicio del panel.
 */
export function safeAdminRedirect(destino: string | null | undefined): string {
	const fallback = '/admin';
	if (!destino) return fallback;
	if (!destino.startsWith('/admin')) return fallback;
	if (destino.startsWith('//') || destino.includes('\\')) return fallback;
	if (destino.startsWith('/admin/login') || destino.startsWith('/admin/logout')) return fallback;
	// Debe ser exactamente /admin o seguir con /, ? o # (no "/administrador-falso").
	const next = destino.charAt('/admin'.length);
	if (next && !['/', '?', '#'].includes(next)) return fallback;
	return destino;
}
