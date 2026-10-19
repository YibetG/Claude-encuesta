<script lang="ts">
	import { resolve } from '$app/paths';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { formatDateTime } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Assessments · Administración</title>
</svelte:head>

<div class="flex flex-wrap items-center justify-between gap-4">
	<h1 class="text-2xl font-semibold tracking-tight">Assessments</h1>
	<a href={resolve('/admin/(app)/assessments/nuevo')} class={ui.btnPrimary}>Nuevo assessment</a>
</div>

<p class="mt-2 text-sm">
	{#if data.includeArchived}
		<a href={resolve('/admin/(app)')} class="text-indigo-600 hover:underline">Ocultar archivados</a>
	{:else}
		<!-- resolve() no acepta query string junto a un id de ruta con grupo; se agrega aparte. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href="{resolve('/admin/(app)')}?archivados=1" class="text-indigo-600 hover:underline"
			>Mostrar archivados</a
		>
	{/if}
</p>

{#if data.assessments.length === 0}
	<div class="mt-6 {ui.card} text-center text-slate-600">
		<p>Todavía no hay assessments.</p>
		<p class="mt-1 text-sm">Cree el primero con el botón "Nuevo assessment".</p>
	</div>
{:else}
	<div class="mt-4 overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
		<table class="min-w-full divide-y divide-slate-200 text-sm">
			<thead class="bg-slate-50 text-left text-slate-600">
				<tr>
					<th scope="col" class="px-4 py-2 font-medium">Título</th>
					<th scope="col" class="px-4 py-2 font-medium">Estado</th>
					<th scope="col" class="px-4 py-2 font-medium">Disponible</th>
					<th scope="col" class="px-4 py-2 text-right font-medium">Preguntas</th>
					<th scope="col" class="px-4 py-2 text-right font-medium">Participantes</th>
					<th scope="col" class="px-4 py-2 text-right font-medium">Entregas</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.assessments as a (a.id)}
					<tr class="hover:bg-slate-50">
						<td class="px-4 py-3">
							<a
								href={resolve('/admin/(app)/assessments/[id]', { id: a.id })}
								class="font-medium text-indigo-700 hover:underline">{a.title}</a
							>
						</td>
						<td class="px-4 py-3"><StatusBadge status={a.status} /></td>
						<td class="px-4 py-3 text-slate-600">
							<span class="whitespace-nowrap">{formatDateTime(a.startsAt, a.timezone)}</span>
							<span aria-hidden="true">→</span><span class="sr-only">hasta</span>
							<span class="whitespace-nowrap">{formatDateTime(a.endsAt, a.timezone)}</span>
						</td>
						<td class="px-4 py-3 text-right tabular-nums">{a.questionCount}</td>
						<td class="px-4 py-3 text-right tabular-nums">{a.participantCount}</td>
						<td class="px-4 py-3 text-right tabular-nums">{a.submittedCount}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
