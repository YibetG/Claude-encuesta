<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Entrega registrada · {data.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12 text-center">
	<div
		class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700"
		aria-hidden="true"
	>
		✓
	</div>
	<h1 class="mt-4 text-2xl font-semibold tracking-tight">
		¡Gracias! Sus respuestas fueron entregadas
	</h1>
	<p class="mt-3 text-slate-600">
		Su entrega de <strong>{data.title}</strong> quedó registrada. Ya puede cerrar esta ventana.
	</p>
</main>
