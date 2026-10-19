<script lang="ts">
	import { resolve } from '$app/paths';
	import BarList, { type BarItem } from '#lib/components/BarList.svelte';
	import ParticipantStatusBadge from '#lib/components/ParticipantStatusBadge.svelte';
	import { formatDateTime, formatPercent } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const a = $derived(data.assessment);
	const r = $derived(data.report);
	const s = $derived(r.summary);

	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

	/** Resumen: alineación de cada pregunta de selección (una serie, un color). */
	const overview = $derived<BarItem[]>(
		r.choice.map((c) => ({
			key: c.id,
			label: `${c.number}. ${c.prompt.length > 60 ? c.prompt.slice(0, 57) + '…' : c.prompt}`,
			rate: c.alignmentRate ?? 0,
			value: formatPercent(c.alignmentRate),
			tooltip:
				c.alignmentRate === null
					? `Pregunta ${c.number}: sin respuestas`
					: `Pregunta ${c.number}: ${c.aligned} de ${c.respondents} con la opción esperada (${formatPercent(c.alignmentRate)})`,
			highlight: true,
			href: `#pregunta-${c.number}`
		}))
	);

	function optionBars(c: (typeof r.choice)[number]): BarItem[] {
		return c.options.map((o) => ({
			key: o.id,
			label: o.text,
			rate: o.rate,
			value: `${o.count} · ${formatPercent(c.respondents ? o.rate : null)}`,
			tooltip: `${o.text}: ${plural(o.count, 'persona', 'personas')} (${formatPercent(c.respondents ? o.rate : null)})`,
			highlight: o.isExpected,
			badge: o.isExpected ? '✓ Esperada' : undefined
		}));
	}

	const hasFilters = $derived(!!(r.filters.area || r.filters.cargo));
	const tiles = $derived([
		{ label: 'Participantes', value: String(s.invited) },
		{ label: 'Entregas', value: String(s.submitted) },
		{ label: 'Tasa de participación', value: formatPercent(s.participationRate) },
		{ label: 'En progreso', value: String(s.inProgress) }
	]);
</script>

<svelte:head>
	<title>Reportes · {a.title}</title>
</svelte:head>

<div class="space-y-8">
	<!-- Descargas (respetan los filtros aplicados) -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-slate-600">
			{hasFilters
				? 'Las descargas incluyen solo los participantes del filtro aplicado.'
				: 'Descargue el informe completo.'}
		</p>
		<div class="flex gap-2">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- se agrega la query de filtros -->
			<a
				href="{resolve('/admin/(app)/assessments/[id]/reportes/excel', { id: a.id })}{data.query}"
				download
				class={ui.btnSecondary}>Descargar Excel</a
			>
			<a
				href="{resolve('/admin/(app)/assessments/[id]/reportes/pdf', { id: a.id })}{data.query}"
				download
				class={ui.btnPrimary}>Descargar PDF</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</div>

	<!-- Filtros -->
	{#if data.areas.length || data.cargos.length}
		<form method="GET" class="flex flex-wrap items-end gap-3" data-sveltekit-keepfocus>
			{#if data.areas.length}
				<div>
					<label for="f-area" class={ui.label}>Área</label>
					<select id="f-area" name="area" value={r.filters.area ?? ''} class={ui.input}>
						<option value="">Todas</option>
						{#each data.areas as v (v)}<option value={v}>{v}</option>{/each}
					</select>
				</div>
			{/if}
			{#if data.cargos.length}
				<div>
					<label for="f-cargo" class={ui.label}>Cargo</label>
					<select id="f-cargo" name="cargo" value={r.filters.cargo ?? ''} class={ui.input}>
						<option value="">Todos</option>
						{#each data.cargos as v (v)}<option value={v}>{v}</option>{/each}
					</select>
				</div>
			{/if}
			<button class={ui.btnSecondary}>Aplicar</button>
			{#if hasFilters}
				<a
					href={resolve('/admin/(app)/assessments/[id]/reportes', { id: a.id })}
					class="py-2 text-sm text-indigo-600 hover:underline">Quitar filtros</a
				>
			{/if}
		</form>
	{/if}

	<!-- Resumen general -->
	<section aria-labelledby="resumen" class="space-y-4">
		<h2 id="resumen" class="text-lg font-semibold">Resumen general</h2>
		<div class="grid gap-4 lg:grid-cols-[auto_1fr]">
			<div class="{ui.card} flex flex-col justify-center">
				<p class="text-sm text-slate-500">Alineación promedio</p>
				<p class="text-5xl font-semibold tracking-tight tabular-nums">
					{formatPercent(s.averageAlignment)}
				</p>
				<p class="mt-1 max-w-xs text-xs text-slate-500">
					Promedio, entre las preguntas de selección, del porcentaje que eligió la opción esperada.
				</p>
			</div>
			<dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				{#each tiles as t (t.label)}
					<div class="{ui.card} py-4">
						<dt class="text-sm text-slate-500">{t.label}</dt>
						<dd class="mt-1 text-2xl font-semibold tabular-nums">{t.value}</dd>
					</div>
				{/each}
			</dl>
		</div>

		{#if s.mostAligned.length}
			<div class="grid gap-4 md:grid-cols-2">
				{#each [{ title: 'Mayor alineación', list: s.mostAligned }, { title: 'Menor alineación', list: s.leastAligned }] as group (group.title)}
					{#if group.list.length}
						<div class={ui.card}>
							<h3 class="text-sm font-semibold">{group.title}</h3>
							<ol class="mt-2 space-y-1 text-sm">
								{#each group.list as c (c.id)}
									<li class="flex justify-between gap-3">
										<a href="#pregunta-{c.number}" class="truncate text-slate-700 hover:underline"
											>{c.number}. {c.prompt}</a
										>
										<span class="shrink-0 font-medium tabular-nums"
											>{formatPercent(c.alignmentRate)}</span
										>
									</li>
								{/each}
							</ol>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</section>

	{#if s.submitted === 0}
		<p class={ui.alertWarning}>
			{hasFilters
				? 'No hay entregas para los filtros seleccionados.'
				: 'Todavía no hay entregas. Los resultados aparecerán cuando los participantes entreguen sus respuestas.'}
		</p>
	{/if}

	<!-- Alineación por pregunta -->
	{#if r.choice.length}
		<section aria-labelledby="alineacion" class={ui.card}>
			<h2 id="alineacion" class="text-lg font-semibold">Alineación por pregunta</h2>
			<p class="mt-1 mb-4 text-sm text-slate-500">
				Porcentaje de quienes respondieron que eligió la opción esperada.
			</p>
			<BarList items={overview} label="Alineación por pregunta" />
		</section>
	{/if}

	<!-- Resultados por pregunta -->
	<section aria-labelledby="por-pregunta" class="space-y-4">
		<h2 id="por-pregunta" class="text-lg font-semibold">Resultados por pregunta</h2>
		{#each r.choice as c (c.id)}
			<article id="pregunta-{c.number}" class="{ui.card} scroll-mt-20">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<h3 class="font-medium whitespace-pre-line">
						<span class="text-slate-500">{c.number}.</span>
						{c.prompt}
					</h3>
					<p class="text-sm whitespace-nowrap">
						Alineación <strong class="tabular-nums">{formatPercent(c.alignmentRate)}</strong>
					</p>
				</div>
				<p class="mt-1 text-xs text-slate-500">
					{plural(c.respondents, 'persona respondió', 'personas respondieron')} · {plural(
						c.aligned,
						'eligió',
						'eligieron'
					)} la opción esperada{#if c.omitted}
						· {plural(c.omitted, 'la omitió', 'la omitieron')}{/if}
				</p>
				<div class="mt-4">
					<BarList items={optionBars(c)} label="Respuestas de la pregunta {c.number}" />
				</div>
			</article>
		{/each}

		{#each r.open as q (q.id)}
			<article id="pregunta-{q.number}" class="{ui.card} scroll-mt-20">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<h3 class="font-medium whitespace-pre-line">
						<span class="text-slate-500">{q.number}.</span>
						{q.prompt}
					</h3>
					<span class="text-xs whitespace-nowrap text-slate-500">Respuesta abierta</span>
				</div>
				<details class="mt-3">
					<summary class="cursor-pointer text-sm text-indigo-700">
						Ver {plural(q.responses.length, 'respuesta', 'respuestas')}
					</summary>
					{#if q.responses.length === 0}
						<p class="mt-3 text-sm text-slate-500">Sin respuestas.</p>
					{:else}
						<ul class="mt-3 divide-y divide-slate-100">
							{#each q.responses as resp (resp.email)}
								<li class="py-3">
									<p class="text-xs text-slate-500">
										{resp.participantName}{resp.area ? ` · ${resp.area}` : ''}{resp.cargo
											? ` · ${resp.cargo}`
											: ''}
									</p>
									<p class="mt-1 text-sm whitespace-pre-line text-slate-800">{resp.text}</p>
								</li>
							{/each}
						</ul>
					{/if}
				</details>
				<p class="mt-3 text-xs text-slate-400">
					El análisis con IA estará disponible en una próxima fase.
				</p>
			</article>
		{/each}
	</section>

	<!-- Por participante -->
	<section aria-labelledby="por-participante">
		<h2 id="por-participante" class="text-lg font-semibold">Por participante</h2>
		{#if r.participants.length === 0}
			<p class="mt-3 text-sm text-slate-500">
				No hay participantes{hasFilters ? ' para estos filtros' : ''}.
			</p>
		{:else}
			<div class="mt-3 overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead class="bg-slate-50 text-left text-slate-600">
						<tr>
							<th scope="col" class="px-4 py-2 font-medium">Nombre</th>
							<th scope="col" class="px-4 py-2 font-medium">Área</th>
							<th scope="col" class="px-4 py-2 font-medium">Cargo</th>
							<th scope="col" class="px-4 py-2 font-medium">Estado</th>
							<th scope="col" class="px-4 py-2 font-medium">Fecha de entrega</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each r.participants as p (p.id)}
							<tr>
								<td class="px-4 py-2">
									{p.name}
									<span class="block text-xs text-slate-500">{p.email}</span>
								</td>
								<td class="px-4 py-2 text-slate-600">{p.area ?? '—'}</td>
								<td class="px-4 py-2 text-slate-600">{p.cargo ?? '—'}</td>
								<td class="px-4 py-2"><ParticipantStatusBadge status={p.status} /></td>
								<td class="px-4 py-2 whitespace-nowrap text-slate-600">
									{p.submittedAt ? formatDateTime(p.submittedAt, a.timezone) : '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
