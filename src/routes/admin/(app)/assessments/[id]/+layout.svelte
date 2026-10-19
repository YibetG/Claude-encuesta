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
		}
	]);
</script>

<nav class="text-sm text-slate-500">
	<a href={resolve('/admin/(app)')} class="hover:underline">Assessments</a> /
	<span class="text-slate-700">{data.assessment.title}</span>
</nav>

<div class="mt-2 flex flex-wrap items-center gap-3">
	<h1 class="text-2xl font-semibold tracking-tight">{data.assessment.title}</h1>
	<StatusBadge status={data.assessment.status} />
</div>

<nav aria-label="Secciones del assessment" class="mt-4 border-b border-slate-200">
	<ul class="-mb-px flex gap-4 overflow-x-auto text-sm">
		{#each tabs as tab (tab.href)}
			<li>
				<a
					href={tab.href}
					aria-current={page.url.pathname === tab.href ? 'page' : undefined}
					class="inline-block border-b-2 border-transparent px-1 py-2 whitespace-nowrap text-slate-600 hover:border-slate-300 hover:text-slate-900 aria-[current=page]:border-indigo-600 aria-[current=page]:font-medium aria-[current=page]:text-indigo-700"
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
