<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Plataforma de Assessments</title>
</svelte:head>

<a
	href="#contenido"
	class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
>
	Saltar al contenido
</a>

<div id="contenido" class="min-h-screen">
	{@render children()}
</div>
