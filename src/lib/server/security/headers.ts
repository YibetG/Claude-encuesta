// Encabezados de seguridad que se agregan a todas las respuestas.
// La Content-Security-Policy la genera SvelteKit (con nonces) según la
// configuración `csp` de vite.config.ts; aquí van los demás.

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	// Impide que la app se muestre dentro de un iframe (clickjacking).
	'X-Frame-Options': 'DENY',
	// El navegador no debe adivinar tipos MIME (evita ejecutar subidas como scripts).
	'X-Content-Type-Options': 'nosniff',
	// No filtrar a otros sitios la URL completa (el slug del assessment es semi-secreto).
	'Referrer-Policy': 'same-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'same-origin'
};

/** Aplica los encabezados sin sobrescribir los que la ruta ya haya definido. */
export function applySecurityHeaders(headers: Headers, url: URL): void {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!headers.has(name)) headers.set(name, value);
	}
	// HSTS solo tiene sentido (y solo es válido) sobre HTTPS.
	if (url.protocol === 'https:' && !headers.has('Strict-Transport-Security')) {
		headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
}
