<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Assessments · Administración</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Assessments</h1>
<p class="mt-2 text-slate-600">
	Hola, {data.admin.name}. La gestión de assessments estará disponible en la siguiente fase.
</p>
