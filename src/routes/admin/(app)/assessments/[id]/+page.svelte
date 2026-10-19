<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AssessmentForm from '#lib/components/AssessmentForm.svelte';
	import { STATUS_LABELS } from '#lib/constants.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const a = $derived(data.assessment);
	let copiado = $state(false);

	async function copiarLink() {
		try {
			await navigator.clipboard.writeText(data.publicLink);
			copiado = true;
			setTimeout(() => (copiado = false), 2000);
		} catch {
			copiado = false;
		}
	}
</script>

<svelte:head>
	<title>{a.title} · Administración</title>
</svelte:head>

<div class="space-y-6">
	{#if page.url.searchParams.get('duplicado') === '1'}
		<p class={ui.alertSuccess} role="status">
			Se creó la copia en borrador. Defina una contraseña de acceso antes de publicarla.
		</p>
	{/if}
	{#if form?.statusChanged}
		<p class={ui.alertSuccess} role="status">
			Estado actualizado: {STATUS_LABELS[form.statusChanged]}.
		</p>
	{/if}

	<!-- Estado y publicación -->
	<section class={ui.card} aria-labelledby="estado-titulo">
		<h2 id="estado-titulo" class="text-base font-semibold">Estado y enlace</h2>

		<div class="mt-3">
			<span class={ui.label}>Enlace para participantes</span>
			<div class="mt-1 flex flex-wrap items-center gap-2">
				<code class="rounded bg-slate-100 px-2 py-1 text-sm break-all">{data.publicLink}</code>
				<button type="button" class={ui.btnSecondary} onclick={copiarLink}>
					{copiado ? 'Copiado' : 'Copiar enlace'}
				</button>
			</div>
			<p class={ui.hint}>
				Los participantes necesitan además la contraseña de acceso. Solo podrán ingresar si el
				assessment está publicado y dentro de las fechas.
			</p>
		</div>

		{#if form?.publishErrors}
			<div class="mt-4 {ui.alertError}" role="alert">
				<p class="font-medium">No se puede publicar todavía:</p>
				<ul class="mt-1 list-disc pl-5">
					{#each form.publishErrors as p (p)}<li>{p}</li>{/each}
				</ul>
			</div>
		{:else if a.status === 'borrador' && data.publishProblems.length}
			<div class="mt-4 {ui.alertWarning}">
				<p class="font-medium">Pendiente para publicar:</p>
				<ul class="mt-1 list-disc pl-5">
					{#each data.publishProblems as p (p)}<li>{p}</li>{/each}
				</ul>
			</div>
		{/if}

		<div class="mt-4 flex flex-wrap gap-2">
			{#if a.status !== 'publicado'}
				<form method="POST" action="?/publicar" use:enhance>
					<button class={ui.btnPrimary}>Publicar</button>
				</form>
			{/if}
			{#if a.status !== 'borrador'}
				<form method="POST" action="?/borrador" use:enhance>
					<button class={ui.btnSecondary}>
						{a.status === 'archivado' ? 'Restaurar como borrador' : 'Volver a borrador'}
					</button>
				</form>
			{/if}
			<form method="POST" action="?/duplicar">
				<button class={ui.btnSecondary}>Duplicar</button>
			</form>
			{#if a.status !== 'archivado'}
				<form
					method="POST"
					action="?/archivar"
					use:enhance={({ cancel }) => {
						if (!confirm('¿Archivar este assessment? Los participantes ya no podrán ingresar.'))
							cancel();
					}}
				>
					<button class={ui.btnDanger}>Archivar</button>
				</form>
			{/if}
		</div>
	</section>

	<!-- Contraseña de acceso -->
	<section class={ui.card} aria-labelledby="password-titulo">
		<h2 id="password-titulo" class="text-base font-semibold">Contraseña de acceso</h2>
		<p class="mt-1 text-sm text-slate-600">
			{#if a.hasPassword}
				<span class="font-medium text-emerald-700">Definida.</span> Por seguridad no se puede volver a
				mostrar; si la olvidó, defina una nueva. Las personas que ya están respondiendo no se ven afectadas
				por el cambio.
			{:else}
				<span class="font-medium text-amber-700">Sin definir.</span> Es obligatoria para publicar.
			{/if}
		</p>

		{#if form?.passwordSaved}
			<p class="mt-3 {ui.alertSuccess}" role="status">Contraseña de acceso actualizada.</p>
		{/if}

		<form
			method="POST"
			action="?/password"
			class="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
			use:enhance
		>
			<div>
				<label for="password" class={ui.label}
					>{a.hasPassword ? 'Nueva contraseña' : 'Contraseña'}</label
				>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
					class={ui.input}
				/>
			</div>
			<div>
				<label for="confirm" class={ui.label}>Repetir contraseña</label>
				<input
					id="confirm"
					name="confirm"
					type="password"
					autocomplete="new-password"
					required
					class={ui.input}
				/>
			</div>
			<button class={ui.btnPrimary}>{a.hasPassword ? 'Cambiar' : 'Guardar'}</button>
		</form>
		{#if form?.passwordErrors}
			<p class={ui.fieldError} role="alert">
				{form.passwordErrors.password ?? form.passwordErrors.confirm}
			</p>
		{/if}
	</section>

	<!-- Datos generales -->
	<section class={ui.card} aria-labelledby="datos-titulo">
		<h2 id="datos-titulo" class="mb-4 text-base font-semibold">Datos generales</h2>
		{#if form?.saved}
			<p class="mb-4 {ui.alertSuccess}" role="status">Cambios guardados.</p>
		{/if}
		<AssessmentForm
			action="?/guardar"
			values={form?.values ?? data.values}
			errors={form?.errors ?? {}}
			timezones={data.timezones}
			submitLabel="Guardar cambios"
		/>
	</section>
</div>
