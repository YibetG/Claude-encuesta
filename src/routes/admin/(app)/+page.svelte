<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { formatPercent, formatShortDate } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const k = $derived(data.kpis);

	const tiles = $derived([
		{ label: 'Publicados', value: String(k.published), note: `${k.drafts} en borrador` },
		{ label: 'Entregas', value: String(k.submitted), note: `${k.inProgress} en progreso` },
		{
			label: 'Participación',
			value: formatPercent(k.participationRate),
			note: `${k.submitted} de ${k.participants} participantes`
		},
		{
			label: 'Alineación promedio',
			value: formatPercent(k.averageAlignment),
			note: k.alignmentCount
				? `en ${k.alignmentCount} ${k.alignmentCount === 1 ? 'assessment' : 'assessments'} con entregas`
				: 'aún sin entregas',
			accent: true
		}
	]);
</script>

<svelte:head>
	<title>Assessments · Administración</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div class="flex flex-col gap-1.5">
			<p class={ui.eyebrow}>Panel de administración</p>
			<h1 class={ui.pageTitle}>Assessments</h1>
		</div>
		<a href={resolve('/admin/(app)/assessments/nuevo')} class={ui.btnPrimary}>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.4"
				stroke-linecap="round"
				aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg
			>
			Nuevo assessment
		</a>
	</div>

	{#if page.url.searchParams.get('eliminado') === '1'}
		<p class={ui.alertSuccess} role="status">Assessment eliminado.</p>
	{/if}

	<!-- Indicadores -->
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

	<!-- Búsqueda y archivados -->
	<form method="GET" class="flex flex-wrap items-center gap-3" data-sveltekit-keepfocus>
		{#if data.includeArchived}<input type="hidden" name="archivados" value="1" />{/if}
		<label for="q" class="sr-only">Buscar assessment</label>
		<div
			class="flex flex-1 basis-72 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600"
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				class="text-slate-500"
				aria-hidden="true"
				><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg
			>
			<input
				id="q"
				name="q"
				type="search"
				value={data.q}
				placeholder="Buscar por título"
				class="w-full border-0 bg-transparent py-2.5 text-sm focus:ring-0"
			/>
		</div>
		{#if data.includeArchived}
			<a href={resolve('/admin/(app)')} class={ui.btnSecondary}>Ocultar archivados</a>
		{:else}
			<!-- resolve() no acepta query string junto a un id de ruta con grupo; se agrega aparte. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href="{resolve('/admin/(app)')}?archivados=1" class={ui.btnSecondary}>Mostrar archivados</a
			>
		{/if}
	</form>

	{#if data.assessments.length === 0}
		<div class="{ui.card} text-center text-slate-600">
			{#if data.q}
				<p>Ningún assessment coincide con la búsqueda.</p>
			{:else}
				<p>Todavía no hay assessments.</p>
				<p class="mt-1 text-sm">Cree el primero con el botón "Nuevo assessment".</p>
			{/if}
		</div>
	{:else}
		<ul class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
			{#each data.assessments as a (a.id)}
				{@const generalHref = resolve('/admin/(app)/assessments/[id]', { id: a.id })}
				{@const rate = a.participantCount ? a.submittedCount / a.participantCount : 0}
				<li
					class="flex flex-col gap-4 rounded-2xl border bg-white p-6 {a.status === 'borrador'
						? 'border-dashed border-slate-300'
						: 'border-slate-200'}"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="flex min-w-0 items-start gap-3">
							{#if a.logoUrl}
								<img
									src={a.logoUrl}
									alt=""
									class="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1"
								/>
							{/if}
							<h2 class="font-display text-lg leading-snug font-bold">
								<a href={generalHref} class="text-ink-950 hover:text-brand-700 hover:underline"
									>{a.title}</a
								>
							</h2>
						</div>
						<StatusBadge status={a.status} />
					</div>
					<p class="text-sm text-slate-600">
						{formatShortDate(a.startsAt, a.timezone)} – {formatShortDate(a.endsAt, a.timezone)} · {a.questionCount}
						{a.questionCount === 1 ? 'pregunta' : 'preguntas'}
					</p>

					{#if a.status === 'borrador'}
						<ul class="flex flex-col gap-2 text-sm">
							{#each [{ done: a.questionCount > 0, label: 'Preguntas cargadas' }, { done: a.hasPassword, label: 'Contraseña de acceso' }, { done: a.participantCount > 0, label: 'Participantes cargados' }] as step (step.label)}
								<li
									class="flex items-center gap-2.5 {step.done ? 'text-ink-950' : 'text-slate-600'}"
								>
									{#if step.done}
										<span
											class="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-600 text-white"
											aria-hidden="true"
										>
											<svg
												width="11"
												height="11"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="3.5"
												stroke-linecap="round"
												stroke-linejoin="round"><path d="M5 12l5 5 9-10"></path></svg
											>
										</span>
									{:else}
										<span
											class="h-[18px] w-[18px] rounded-full border-2 border-slate-300"
											aria-hidden="true"
										></span>
									{/if}
									{step.label}<span class="sr-only">{step.done ? ' (listo)' : ' (pendiente)'}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<div class="flex flex-col gap-2">
							<div class="flex justify-between text-sm">
								<span class="text-slate-600">Participación</span>
								<span class="font-semibold"
									>{a.submittedCount} de {a.participantCount} · {formatPercent(
										a.participantCount ? rate : null
									)}</span
								>
							</div>
							<div class="h-2 rounded-full bg-slate-100" aria-hidden="true">
								<div class="h-2 rounded-full bg-brand-600" style="width: {rate * 100}%"></div>
							</div>
						</div>
						<div class="flex gap-6 text-sm">
							<div class="flex flex-col">
								<span class="text-slate-600">Alineación</span>
								<span class="font-display text-xl font-extrabold"
									>{formatPercent(a.averageAlignment)}</span
								>
							</div>
							<div class="flex flex-col">
								<span class="text-slate-600">En progreso</span>
								<span class="font-display text-xl font-extrabold">{a.inProgressCount}</span>
							</div>
						</div>
						{#if a.status === 'publicado' && a.notInvitedCount > 0}
							<p
								class="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									aria-hidden="true"
									><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg
								>
								{a.notInvitedCount}
								{a.notInvitedCount === 1 ? 'persona sin invitación' : 'personas sin invitación'}
							</p>
						{/if}
					{/if}

					<div class="mt-auto flex gap-2 border-t border-slate-100 pt-4">
						{#if a.status === 'borrador'}
							<a href={generalHref} class="{ui.btnDark} flex-1">Continuar configuración</a>
						{:else}
							<a
								href={resolve('/admin/(app)/assessments/[id]/reportes', { id: a.id })}
								class="{ui.btnDark} flex-1">Ver reporte</a
							>
							<a href={generalHref} class="{ui.btnSecondary} flex-1">Gestionar</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
