<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BrandEditor from '#lib/components/BrandEditor.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import { formatShortDate } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const c = $derived(data.client);
</script>

<svelte:head>
	<title>{c.name} · Clientes</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-col gap-1.5">
		<nav class="text-sm text-slate-500">
			<a href={resolve('/admin/(app)/clientes')} class="hover:underline">Clientes</a> / {c.name}
		</nav>
		<h1 class={ui.pageTitle}>{c.name}</h1>
	</div>

	{#if page.url.searchParams.get('creado') === '1'}
		<p class={ui.alertSuccess} role="status">
			Cliente creado. Suba su logo y elija sus colores; luego cree sus assessments.
		</p>
	{/if}

	<!-- Nombre -->
	<section class={ui.card} aria-labelledby="nombre-titulo">
		<h2 id="nombre-titulo" class={ui.sectionTitle}>Nombre</h2>
		<form
			method="POST"
			action="?/renombrar"
			class="mt-3 flex flex-wrap items-end gap-3"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<div class="min-w-64 flex-1">
				<label for="name" class="sr-only">Nombre del cliente</label>
				<input
					id="name"
					name="name"
					required
					maxlength="120"
					value={form?.name ?? c.name}
					aria-invalid={!!form?.nameError}
					class={ui.input}
				/>
				{#if form?.nameError}<p class={ui.fieldError} role="alert">{form.nameError}</p>{/if}
			</div>
			<button class={ui.btnSecondary}>Guardar nombre</button>
		</form>
		{#if form?.renamed}<p class="mt-3 {ui.alertSuccess}" role="status">Nombre guardado.</p>{/if}
	</section>

	<BrandEditor
		logoUrl={c.logoUrl}
		themePrimary={c.themePrimary}
		themeAccent={c.themeAccent}
		previewTitle="Assessment de {c.name}"
		{form}
	/>

	<!-- Assessments del cliente -->
	<section class={ui.card} aria-labelledby="assessments-titulo">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 id="assessments-titulo" class={ui.sectionTitle}>Assessments</h2>
			<a href="{resolve('/admin/(app)/assessments/nuevo')}?cliente={c.id}" class={ui.btnPrimary}>
				Nuevo assessment para {c.name}
			</a>
		</div>
		{#if data.assessments.length === 0}
			<p class="mt-3 text-sm text-slate-600">Este cliente todavía no tiene assessments.</p>
		{:else}
			<ul class="mt-4 divide-y divide-slate-100">
				{#each data.assessments as a (a.id)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
						<a
							href={resolve('/admin/(app)/assessments/[id]', { id: a.id })}
							class="min-w-0 flex-1 font-medium text-ink-950 hover:underline">{a.title}</a
						>
						<StatusBadge status={a.status} />
						<span class="text-sm text-slate-600">
							{formatShortDate(a.startsAt, a.timezone)} – {formatShortDate(a.endsAt, a.timezone)}
						</span>
						<span class="text-sm text-slate-600">
							{a.submittedCount} de {a.participantCount} entregas
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Eliminar -->
	<section class="rounded-2xl border border-red-200 bg-white p-6" aria-labelledby="eliminar-titulo">
		<h2 id="eliminar-titulo" class="text-base font-semibold text-red-800">Eliminar cliente</h2>
		{#if data.assessments.length}
			<p class="mt-1 text-sm text-slate-700">
				Solo se puede eliminar un cliente sin assessments. Elimine sus assessments o asígnelos a
				otro cliente primero.
			</p>
		{:else}
			<p class="mt-1 text-sm text-slate-700">Se borrarán el cliente, su logo y sus colores.</p>
			<form
				method="POST"
				action="?/eliminar"
				class="mt-3"
				use:enhance={({ cancel }) => {
					if (!confirm(`¿Eliminar el cliente "${c.name}"?`)) return cancel();
				}}
			>
				<button class={ui.btnDanger}>Eliminar cliente</button>
			</form>
		{/if}
		{#if form?.deleteError}<p class="mt-2 {ui.fieldError}" role="alert">{form.deleteError}</p>{/if}
	</section>
</div>
