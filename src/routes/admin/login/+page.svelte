<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let enviando = $state(false);
</script>

<svelte:head>
	<title>Ingreso de administradores</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center px-4 py-12">
	<div class="w-full max-w-sm">
		<h1 class="text-center text-2xl font-semibold tracking-tight">Ingreso de administradores</h1>

		<form
			method="POST"
			class="mt-8 space-y-5 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200"
			use:enhance={({ formElement }) => {
				enviando = true;
				return async ({ result, update }) => {
					// Se conserva el email escrito, pero la contraseña se borra tras un error.
					await update({ reset: false });
					if (result.type === 'failure') {
						const password = formElement.elements.namedItem('password');
						if (password instanceof HTMLInputElement) {
							password.value = '';
							password.focus();
						}
					}
					enviando = false;
				};
			}}
		>
			{#if form?.error}
				<p
					role="alert"
					class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
				>
					{form.error}
				</p>
			{/if}

			<div>
				<label for="email" class="block text-sm font-medium text-slate-700">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="username"
					required
					value={form?.email ?? ''}
					class="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
				/>
			</div>

			<div>
				<label for="password" class="block text-sm font-medium text-slate-700">Contraseña</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
					class="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
				/>
			</div>

			<button
				type="submit"
				disabled={enviando}
				class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60"
			>
				{enviando ? 'Ingresando…' : 'Ingresar'}
			</button>
		</form>
	</div>
</main>
