<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const titles: Record<number, string> = {
		403: 'Acceso no permitido',
		404: 'Página no encontrada',
		429: 'Demasiados intentos',
		500: 'Error del servidor'
	};
</script>

<svelte:head>
	<title>{titles[page.status] ?? 'Error'}</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
	<p class="text-sm font-semibold text-indigo-600">Error {page.status}</p>
	<h1 class="mt-2 text-2xl font-semibold">{titles[page.status] ?? 'Algo salió mal'}</h1>
	{#if page.error?.message && page.status !== 404}
		<p class="mt-3 text-slate-600">{page.error.message}</p>
	{/if}
	<p class="mt-8">
		<a href={resolve('/')} class="text-indigo-600 underline hover:text-indigo-500"
			>Volver al inicio</a
		>
	</p>
</main>
