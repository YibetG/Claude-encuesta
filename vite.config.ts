import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(({ mode }) => {
	const dev = mode === 'development';

	return {
		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				// Content-Security-Policy: SvelteKit agrega nonces a sus scripts inline.
				// No se cargan recursos de terceros: todo se sirve desde la propia app.
				csp: {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						// En desarrollo Vite inyecta los estilos con JS, lo que requiere 'unsafe-inline'.
						'style-src': dev ? ['self', 'unsafe-inline'] : ['self'],
						// Atributos style="" (ej. ancho de las barras de los gráficos).
						'style-src-attr': ['unsafe-inline'],
						'img-src': ['self', 'data:'],
						'font-src': ['self'],
						'connect-src': ['self'],
						'object-src': ['none'],
						'base-uri': ['self'],
						'form-action': ['self'],
						'frame-ancestors': ['none']
					}
				},
				// La verificación de origen (CSRF) de los form actions queda activa:
				// no se agregan orígenes de confianza.
				csrf: { trustedOrigins: [] }
			})
		],
		test: {
			expect: { requireAssertions: true },
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'server',
						environment: 'node',
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
					}
				}
			]
		}
	};
});
