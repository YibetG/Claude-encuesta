<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const tabs = $derived([
		{
			href: resolve('/admin/(app)/assessments/[id]', { id: data.assessment.id }),
			label: 'General'
		},
		{
			href: resolve('/admin/(app)/assessments/[id]/preguntas', { id: data.assessment.id }),
			label: `Preguntas (${data.questionCounts.total})`
		},
		{
			href: resolve('/admin/(app)/assessments/[id]/participantes', { id: data.assessment.id }),
			label: `Participantes (${data.participantCount})`
		},
		{
			href: resolve('/admin/(app)/assessments/[id]/invitaciones', { id: data.assessment.id }),
			label: 'Invitaciones'
		},
		{
			href: resolve('/admin/(app)/assessments/[id]/reportes', { id: data.assessment.id }),
			label: 'Reportes'
		},
		...(data.series
			? [
					{
						href: resolve('/admin/(app)/assessments/[id]/mediciones', { id: data.assessment.id }),
						label: `Mediciones (${data.series.length})`
					}
				]
			: [])
	]);
</script>

<nav aria-label="Ruta" class="text-sm text-slate-600">
	<a href={resolve('/admin/(app)')} class="hover:text-ink-950 hover:underline">Assessments</a> /
	<span class="text-ink-950">{data.assessment.title}</span>
</nav>

<div class="mt-3 flex flex-wrap items-center gap-4">
	{#if data.assessment.logoUrl}
		<img
			src={data.assessment.logoUrl}
			alt="Logo del cliente"
			class="h-12 w-12 rounded-xl border border-slate-200 bg-white object-contain p-1.5"
		/>
	{/if}
	<h1 class="font-display text-3xl font-extrabold tracking-tight">{data.assessment.title}</h1>
	<StatusBadge status={data.assessment.status} />
</div>

<nav aria-label="Secciones del assessment" class="mt-5 border-b border-slate-200">
	<ul class="-mb-px flex gap-2 overflow-x-auto text-sm">
		{#each tabs as tab (tab.href)}
			<li>
				<a
					href={tab.href}
					aria-current={page.url.pathname === tab.href ? 'page' : undefined}
					class="inline-block border-b-2 border-transparent px-3 py-3 font-medium whitespace-nowrap text-slate-600 hover:text-ink-950 aria-[current=page]:border-brand-600 aria-[current=page]:font-semibold aria-[current=page]:text-ink-950"
				>
					{tab.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<div class="mt-6">
	{@render children()}
</div>
