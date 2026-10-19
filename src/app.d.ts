// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Administrador con sesión válida, o `null`. Lo completa hooks.server.ts. */
			admin: import('#lib/server/auth/admin-session.ts').SessionAdmin | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
