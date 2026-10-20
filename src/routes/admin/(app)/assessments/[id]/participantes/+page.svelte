<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ParticipantStatusBadge from '#lib/components/ParticipantStatusBadge.svelte';
	import { PARTICIPANT_STATUS_LABELS } from '#lib/schemas/participant.ts';
	import { formatDateTime } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const a = $derived(data.assessment);
	const templateHref = $derived(
		resolve('/admin/(app)/assessments/[id]/participantes/plantilla', { id: a.id })
	);
	const hasFilters = $derived(Object.values(data.filters).some(Boolean));
</script>

<svelte:head>
	<title>Participantes · {a.title}</title>
</svelte:head>

<div class="space-y-6">
	{#if a.accessMode === 'abierto'}
		<p class={ui.alertWarning}>
			Este assessment está en modo <strong>abierto</strong>: cualquier persona con la contraseña
			puede responder y aparecerá aquí automáticamente. La lista sirve para enviar invitaciones.
		</p>
	{/if}

	<!-- Resumen -->
	<dl class="grid grid-cols-2 gap-3 sm:grid-cols-5">
		{#each [['Total', data.counts.total], [PARTICIPANT_STATUS_LABELS.pendiente, data.counts.pendiente], [PARTICIPANT_STATUS_LABELS.en_progreso, data.counts.en_progreso], [PARTICIPANT_STATUS_LABELS.completado, data.counts.completado], ['Sin invitar', data.counts.sinInvitar]] as [label, value] (label)}
			<div class="rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
				<dt class="text-xs text-slate-500">{label}</dt>
				<dd class="text-xl font-semibold tabular-nums">{value}</dd>
			</div>
		{/each}
	</dl>

	<!-- Agregar e importar -->
	<div class="grid gap-4 lg:grid-cols-2">
		<details class={ui.card} open={!!form?.addErrors}>
			<summary class="cursor-pointer text-sm font-semibold">Agregar participante</summary>
			<form method="POST" action="?/agregar" class="mt-4 grid gap-3 sm:grid-cols-2" use:enhance>
				<div>
					<label for="p-name" class={ui.label}>Nombre</label>
					<input
						id="p-name"
						name="name"
						required
						value={form?.addValues?.name ?? ''}
						aria-invalid={!!form?.addErrors?.name}
						class={ui.input}
					/>
					{#if form?.addErrors?.name}<p class={ui.fieldError}>{form.addErrors.name}</p>{/if}
				</div>
				<div>
					<label for="p-email" class={ui.label}>Email</label>
					<input
						id="p-email"
						name="email"
						type="email"
						required
						value={form?.addValues?.email ?? ''}
						aria-invalid={!!form?.addErrors?.email}
						class={ui.input}
					/>
					{#if form?.addErrors?.email}<p class={ui.fieldError}>{form.addErrors.email}</p>{/if}
				</div>
				<div>
					<label for="p-area" class={ui.label}
						>Área <span class="text-slate-400">(opcional)</span></label
					>
					<input id="p-area" name="area" value={form?.addValues?.area ?? ''} class={ui.input} />
				</div>
				<div>
					<label for="p-cargo" class={ui.label}
						>Cargo <span class="text-slate-400">(opcional)</span></label
					>
					<input id="p-cargo" name="cargo" value={form?.addValues?.cargo ?? ''} class={ui.input} />
				</div>
				<div class="sm:col-span-2">
					<button class={ui.btnPrimary}>Agregar</button>
				</div>
			</form>
		</details>

		<details class={ui.card} open={!!form?.importErrors || !!form?.imported}>
			<summary class="cursor-pointer text-sm font-semibold">Cargar desde Excel o CSV</summary>
			<div class="mt-4 space-y-3 text-sm">
				<p class="text-slate-600">
					Columnas: <code>nombre</code>, <code>email</code> y opcionalmente <code>area</code>,
					<code>cargo</code> u otras. Descargue la
					<a href={templateHref} class="text-brand-600 underline" download>plantilla</a>. Si un
					email ya existe, se actualizan sus datos.
				</p>
				<form
					method="POST"
					action="?/importar"
					enctype="multipart/form-data"
					class="flex flex-wrap items-end gap-3"
					use:enhance
				>
					<div>
						<label for="archivo" class={ui.label}>Archivo (.xlsx o .csv, máx. 2 MB)</label>
						<input
							id="archivo"
							name="archivo"
							type="file"
							accept=".xlsx,.csv"
							required
							class="mt-1 block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
						/>
					</div>
					<button class={ui.btnSecondary}>Cargar</button>
				</form>
				{#if form?.importErrors}
					<div class={ui.alertError} role="alert">
						<p class="font-medium">No se cargó ningún participante:</p>
						<ul class="mt-1 max-h-60 list-disc overflow-y-auto pl-5">
							{#each form.importErrors as e (e)}<li>{e}</li>{/each}
						</ul>
					</div>
				{/if}
				{#if form?.imported}
					<p class={ui.alertSuccess} role="status">
						Carga completa: {form.imported.created} nuevos, {form.imported.updated} actualizados.
					</p>
				{/if}
			</div>
		</details>
	</div>

	{#if form?.added}
		<p class={ui.alertSuccess} role="status">Participante agregado: {form.added}.</p>
	{/if}
	{#if form?.deleteError}
		<p class={ui.alertError} role="alert">{form.deleteError}</p>
	{/if}

	<!-- Filtros -->
	<form method="GET" class="flex flex-wrap items-end gap-3" data-sveltekit-keepfocus>
		<div>
			<label for="f-q" class={ui.label}>Buscar</label>
			<input
				id="f-q"
				name="q"
				type="search"
				value={data.filters.q}
				placeholder="Nombre o email"
				class={ui.input}
			/>
		</div>
		<div>
			<label for="f-estado" class={ui.label}>Estado</label>
			<select id="f-estado" name="estado" value={data.filters.estado} class={ui.input}>
				<option value="">Todos</option>
				{#each data.statuses as s (s)}<option value={s}>{PARTICIPANT_STATUS_LABELS[s]}</option
					>{/each}
			</select>
		</div>
		{#if data.areas.length}
			<div>
				<label for="f-area" class={ui.label}>Área</label>
				<select id="f-area" name="area" value={data.filters.area} class={ui.input}>
					<option value="">Todas</option>
					{#each data.areas as v (v)}<option value={v}>{v}</option>{/each}
				</select>
			</div>
		{/if}
		{#if data.cargos.length}
			<div>
				<label for="f-cargo" class={ui.label}>Cargo</label>
				<select id="f-cargo" name="cargo" value={data.filters.cargo} class={ui.input}>
					<option value="">Todos</option>
					{#each data.cargos as v (v)}<option value={v}>{v}</option>{/each}
				</select>
			</div>
		{/if}
		<button class={ui.btnSecondary}>Filtrar</button>
		{#if hasFilters}
			<a
				href={resolve('/admin/(app)/assessments/[id]/participantes', { id: a.id })}
				class="py-2 text-sm text-brand-600 hover:underline">Quitar filtros</a
			>
		{/if}
	</form>

	<!-- Tabla -->
	{#if data.participants.length === 0}
		<p class="{ui.card} text-center text-slate-600">
			{hasFilters
				? 'Ningún participante coincide con los filtros.'
				: 'Todavía no hay participantes.'}
		</p>
	{:else}
		<div class="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
			<table class="min-w-full divide-y divide-slate-200 text-sm">
				<caption class="sr-only">Participantes del assessment</caption>
				<thead class="bg-slate-50 text-left text-slate-600">
					<tr>
						<th scope="col" class="px-4 py-2 font-medium">Nombre</th>
						<th scope="col" class="px-4 py-2 font-medium">Email</th>
						<th scope="col" class="px-4 py-2 font-medium">Área</th>
						<th scope="col" class="px-4 py-2 font-medium">Cargo</th>
						<th scope="col" class="px-4 py-2 font-medium">Estado</th>
						<th scope="col" class="px-4 py-2 font-medium">Invitación</th>
						<th scope="col" class="px-4 py-2"><span class="sr-only">Acciones</span></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.participants as p (p.id)}
						<tr>
							<td class="px-4 py-2">
								{p.name}
								{#if p.source === 'abierto'}
									<span class="ml-1 text-xs text-slate-500">(ingreso abierto)</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-slate-600">{p.email}</td>
							<td class="px-4 py-2 text-slate-600">{p.area ?? '—'}</td>
							<td class="px-4 py-2 text-slate-600">{p.cargo ?? '—'}</td>
							<td class="px-4 py-2"><ParticipantStatusBadge status={p.status} /></td>
							<td class="px-4 py-2 whitespace-nowrap text-slate-600">
								{#if p.lastEmailStatus === 'error'}
									<span class="text-red-700" title={p.lastEmailError ?? ''}>Error al enviar</span>
								{:else if p.invitedAt}
									{formatDateTime(p.invitedAt, a.timezone)}
								{:else}
									<span class="text-slate-400">No enviada</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-right">
								{#if p.status === 'pendiente'}
									<form
										method="POST"
										action="?/eliminar"
										use:enhance={({ cancel }) => {
											if (!confirm(`¿Eliminar a ${p.name}?`)) cancel();
										}}
									>
										<input type="hidden" name="participantId" value={p.id} />
										<button
											class="text-sm text-red-700 hover:underline"
											aria-label="Eliminar a {p.name}">Eliminar</button
										>
									</form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
