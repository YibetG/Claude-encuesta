/**
 * Opciones comunes de las cookies de sesión (admin y participante).
 *
 * `secure` se fija explícitamente: SvelteKit lo desactiva por su cuenta en
 * http://localhost incluso en producción. Los navegadores aceptan cookies Secure
 * en localhost, así que solo se omite en `vite dev`. En un despliegue real la app
 * debe servirse por HTTPS (si no, el navegador descartará la cookie).
 */
export const SESSION_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: process.env.NODE_ENV !== 'development'
} as const;
