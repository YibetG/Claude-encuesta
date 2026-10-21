<script lang="ts">
	import { resolve } from '$app/paths';
	import BarList from '#lib/components/BarList.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { formatPercent, formatShortDate } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const c = $derived(data.client);
	const r = $derived(data.report);
	const s = $derived(r.summary);

	// Con muchos assessments, la tabla por grupo muestra solo el total (no cabe una columna por cada uno).
	const MAX_COLUMNS = 6;
	const columns = $derived(r.assessments.length <= MAX_COLUMNS ? r.assessments : []);

	const tiles = $derived([
		{
			label: 'Assessments',
			value: String(s.assessments),
			note: `${s.withSubmissions} con entregas`
		},
		{ label: 'Personas', value: String(s.people), note: 'distintas, por correo' },
		{
			label: 'Participación',
			value: formatPercent(s.participationRate),
			note: `${s.submitted} entregas de ${s.participants} invitaciones`
		},
		{
			label: 'Acierto promedio',
			value: formatPercent(s.averageScore),
			note: `alineación promedio ${formatPercent(s.averageAlignment)}`,
			accent: true
		}
	]);

	const evolution = $derived(
		r.assessments
			.filter((a) => a.averageScore !== null)
			.map((a) => ({
				key: a.id,
				label: `${a.title} (${formatShortDate(a.startsAt, a.timezone)})`,
				rate: a.averageScore!,
				value: formatPercent(a.averageScore),
				tooltip: `${a.submitted} entregas · alineación ${formatPercent(a.averageAlignment)}`,
				highlight: true
			}))
	);

	const excelHref = $derived(resolve('/admin/(app)/clientes/[id]/informe/excel', { id: c.id }));
	const pdfHref = $derived(resolve('/admin/(app)/clientes/[id]/informe/pdf', { id: c.id }));
</script>

<svelte:head>
	<title>Informe general · {c.name}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div class="flex flex-col gap-1.5">
			<nav class="text-sm text-slate-500">
				<a href={resolve('/admin/(app)/clientes')} class="hover:underline">Clientes</a> /
				<a href={resolve('/admin/(app)/clientes/[id]', { id: c.id })} class="hover:underline"
					>{c.name}</a
				> / Informe general
			</nav>
			<div class="flex items-center gap-3">
				{#if c.logoUrl}
					<img
						src={c.logoUrl}
						alt=""
						class="h-11 w-auto max-w-32 rounded-lg border border-slate-200 bg-white object-contain p-1"
					/>
				{/if}
				<h1 class={ui.pageTitle}>Informe general de {c.name}</h1>
			</div>
		</div>
		{#if r.assessments.length}
			<div class="flex gap-2">
				<a href={excelHref} class={ui.btnSecondary} download>Descargar Excel</a>
				<a href={pdfHref} class={ui.btnPrimary} download>Descargar PDF</a>
			</div>
		{/if}
	</div>

	{#if r.assessments.length === 0}
		<p class="{ui.card} text-center text-slate-600">
			Este cliente todavía no tiene assessments publicados. El informe aparece cuando haya al menos
			uno.
		</p>
	{:else}
		<dl class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			{#each tiles as t (t.label)}
				<div class="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white px-5 py-4">
					<dt class="text-sm text-slate-600">{t.label}</dt>
					<dd
						class="font-display text-3xl font-extrabold {t.accent
							? 'text-brand-700'
							: 'text-ink-950'}"
					>
						{t.value}
					</dd>
					<dd class="text-sm text-slate-600">{t.note}</dd>
				</div>
			{/each}
		</dl>

		<p class="-mt-4 text-sm text-slate-600">
			<strong>Acierto</strong>: porcentaje de preguntas de selección que cada persona respondió con
			la opción esperada, promediado entre quienes entregaron. <strong>Alineación</strong>:
			porcentaje de quienes respondieron cada pregunta que eligió la opción esperada. Solo cuentan
			entregas finales; los borradores no se incluyen.
		</p>

		{#if evolution.length}
			<section class={ui.card} aria-labelledby="evolucion-titulo">
				<h2 id="evolucion-titulo" class={ui.sectionTitle}>Acierto promedio por assessment</h2>
				<p class="mt-1 mb-4 text-sm text-slate-600">En orden de fecha de inicio.</p>
				<BarList items={evolution} label="Acierto promedio por assessment" />
			</section>
		{/if}

		<section class={ui.card} aria-labelledby="assessments-titulo">
			<h2 id="assessments-titulo" class={ui.sectionTitle}>Assessments</h2>
			<div class="mt-4 overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="text-left text-xs tracking-wide text-slate-600 uppercase">
						<tr>
							<th class="py-2 pr-4 font-semibold">Assessment</th>
							<th class="py-2 pr-4 font-semibold">Periodo</th>
							<th class="py-2 pr-4 font-semibold">Estado</th>
							<th class="py-2 pr-4 text-right font-semibold">Entregas</th>
							<th class="py-2 pr-4 text-right font-semibold">Participación</th>
							<th class="py-2 pr-4 text-right font-semibold">Alineación</th>
							<th class="py-2 text-right font-semibold">Acierto</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each r.assessments as a (a.id)}
							<tr>
								<td class="py-2.5 pr-4">
									<a
										href={resolve('/admin/(app)/assessments/[id]/reportes', { id: a.id })}
										class="font-medium text-ink-950 hover:underline">{a.title}</a
									>
								</td>
								<td class="py-2.5 pr-4 whitespace-nowrap text-slate-600">
									{formatShortDate(a.startsAt, a.timezone)} – {formatShortDate(
										a.endsAt,
										a.timezone
									)}
								</td>
								<td class="py-2.5 pr-4"><StatusBadge status={a.status} /></td>
								<td class="py-2.5 pr-4 text-right tabular-nums"
									>{a.submitted} de {a.participants}</td
								>
								<td class="py-2.5 pr-4 text-right tabular-nums"
									>{formatPercent(a.participationRate)}</td
								>
								<td class="py-2.5 pr-4 text-right tabular-nums"
									>{formatPercent(a.averageAlignment)}</td
								>
								<td class="py-2.5 text-right font-semibold tabular-nums"
									>{formatPercent(a.averageScore)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		{#each [{ id: 'area', title: 'Por área', groups: r.byArea }, { id: 'cargo', title: 'Por cargo', groups: r.byCargo }] as block (block.id)}
			{#if block.groups.length}
				<section class={ui.card} aria-labelledby="{block.id}-titulo">
					<h2 id="{block.id}-titulo" class={ui.sectionTitle}>{block.title}</h2>
					<p class="mt-1 text-sm text-slate-600">
						Acierto promedio de las entregas de cada grupo{columns.length > 1
							? ', en total y en cada assessment'
							: ''}.
					</p>
					<div class="mt-4 overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="text-left text-xs tracking-wide text-slate-600 uppercase">
								<tr>
									<th class="py-2 pr-4 font-semibold">{block.id === 'area' ? 'Área' : 'Cargo'}</th>
									<th class="py-2 pr-4 text-right font-semibold">Entregas</th>
									<th class="py-2 pr-4 text-right font-semibold">Acierto total</th>
									{#if columns.length > 1}
										{#each columns as a (a.id)}
											<th
												class="max-w-32 py-2 pr-4 text-right font-semibold normal-case"
												title={a.title}><span class="line-clamp-2">{a.title}</span></th
											>
										{/each}
									{/if}
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each block.groups as g (g.name)}
									<tr>
										<td class="py-2.5 pr-4 {g.name === 'Sin dato' ? 'text-slate-500 italic' : ''}"
											>{g.name}</td
										>
										<td class="py-2.5 pr-4 text-right tabular-nums">{g.submissions}</td>
										<td class="py-2.5 pr-4 text-right font-semibold tabular-nums"
											>{formatPercent(g.averageScore)}</td
										>
										{#if columns.length > 1}
											{#each columns as a (a.id)}
												<td class="py-2.5 pr-4 text-right text-slate-700 tabular-nums"
													>{formatPercent(g.byAssessment[a.id] ?? null)}</td
												>
											{/each}
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>
			{/if}
		{/each}
	{/if}
</div>
