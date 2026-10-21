<script lang="ts">
	import { resolve } from '$app/paths';
	import AssessmentForm from '#lib/components/AssessmentForm.svelte';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Nuevo assessment · Administración</title>
</svelte:head>

<nav class="text-sm text-slate-500">
	<a href={resolve('/admin/(app)')} class="hover:underline">Assessments</a> / Nuevo
</nav>
<h1 class="mt-2 text-2xl font-semibold tracking-tight">Nuevo assessment</h1>

<div class="mt-6 {ui.card}">
	<AssessmentForm
		values={form?.values ?? data.values}
		errors={form?.errors}
		timezones={data.timezones}
		clients={data.clients}
		submitLabel="Crear y agregar preguntas"
	/>
</div>
