<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AssessmentForm from '#lib/components/AssessmentForm.svelte';
	import { STATUS_LABELS } from '#lib/constants.ts';
	import { ui } from '#lib/ui.ts';
	import { resolve } from '$app/paths';
	import { DEFAULT_ACCENT, DEFAULT_PRIMARY } from '#lib/theme.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const a = $derived(data.assessment);
	let confirmTitle = $state('');
	let copiado = $state(false);
	let copiadoClave = $state(false);

	// Contraseña vigente: solo se muestra tras pedirla al servidor (queda en auditoría).
	let oculta = $state(false);
	const revealed = $derived(!oculta && form?.revealedPassword ? form.revealedPassword : null);

	// Nueva contraseña: se puede ver lo escrito o generar una al azar.
	let verNueva = $state(false);
	let nueva = $state('');
	let confirmacion = $state('');

	/** Contraseña legible al azar (sin caracteres que se confunden: 0/O, 1/l/I). */
	function generar() {
		const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
		const bytes = crypto.getRandomValues(new Uint32Array(12));
		const raw = Array.from(bytes, (b) => chars[b % chars.length]).join('');
		const value = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
		nueva = value;
		confirmacion = value;
		verNueva = true;
	}

	async function copiar(text: string, which: 'link' | 'clave') {
		try {
			await navigator.clipboard.writeText(text);
			if (which === 'link') copiado = true;
			else copiadoClave = true;
			setTimeout(() => (which === 'link' ? (copiado = false) : (copiadoClave = false)), 2000);
		} catch {
			// Sin permiso de portapapeles: el texto sigue visible para copiarlo a mano.
		}
	}

	const copiarLink = () => copiar(data.publicLink, 'link');
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
		<h2 id="password-titulo" class={ui.sectionTitle}>Contraseña de acceso</h2>

		{#if !a.hasPassword}
			<p class="mt-1 text-sm text-slate-600">
				<span class="font-semibold text-amber-800">Sin definir.</span> Es obligatoria para publicar.
			</p>
		{:else}
			<div class="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-canvas px-4 py-3">
				<span class="text-sm text-slate-600">Contraseña vigente:</span>
				{#if revealed}
					<code
						class="rounded-md bg-white px-2.5 py-1 font-mono text-base font-semibold tracking-wide text-ink-950 ring-1 ring-slate-200"
						aria-label="Contraseña vigente">{revealed}</code
					>
					<button type="button" class={ui.btnSecondary} onclick={() => copiar(revealed!, 'clave')}>
						{copiadoClave ? 'Copiada' : 'Copiar'}
					</button>
					<button type="button" class={ui.btnSecondary} onclick={() => (oculta = true)}
						>Ocultar</button
					>
				{:else}
					<span class="font-mono text-base tracking-widest text-ink-950" aria-hidden="true"
						>••••••••••</span
					>
					{#if a.passwordViewable}
						<form
							method="POST"
							action="?/verPassword"
							use:enhance={() =>
								async ({ update }) => {
									oculta = false;
									await update({ reset: false });
								}}
						>
							<button class={ui.btnSecondary}>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle
										cx="12"
										cy="12"
										r="3"
									></circle></svg
								>
								Mostrar
							</button>
						</form>
					{/if}
				{/if}
			</div>
			<p class={ui.hint}>
				{#if a.passwordViewable}
					Cada vez que se muestra queda registrado en la auditoría. Si la cambia, las personas que
					ya están respondiendo no se ven afectadas.
				{:else}
					Esta contraseña se definió antes de poder consultarse. Defínala de nuevo para poder verla.
				{/if}
			</p>
			{#if form?.revealError}<p class="mt-2 {ui.alertWarning}">{form.revealError}</p>{/if}
		{/if}

		{#if form?.passwordSaved}
			<p class="mt-4 {ui.alertSuccess}" role="status">Contraseña de acceso actualizada.</p>
		{/if}

		<form
			method="POST"
			action="?/password"
			class="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') {
						nueva = '';
						confirmacion = '';
					}
				}}
		>
			<div>
				<label for="password" class={ui.label}
					>{a.hasPassword ? 'Nueva contraseña' : 'Contraseña'}</label
				>
				<div class="relative">
					<input
						id="password"
						name="password"
						type={verNueva ? 'text' : 'password'}
						autocomplete="new-password"
						minlength="8"
						required
						bind:value={nueva}
						class="{ui.input} pr-11"
					/>
					<button
						type="button"
						class="absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
						aria-label={verNueva ? 'Ocultar lo escrito' : 'Ver lo escrito'}
						aria-pressed={verNueva}
						onclick={() => (verNueva = !verNueva)}
					>
						{#if verNueva}
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><path d="M3 3l18 18"></path><path
									d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"
								></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg
							>
						{:else}
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle
									cx="12"
									cy="12"
									r="3"
								></circle></svg
							>
						{/if}
					</button>
				</div>
			</div>
			<div>
				<label for="confirm" class={ui.label}>Repetir contraseña</label>
				<input
					id="confirm"
					name="confirm"
					type={verNueva ? 'text' : 'password'}
					autocomplete="new-password"
					required
					bind:value={confirmacion}
					class={ui.input}
				/>
			</div>
			<button class={ui.btnPrimary}>{a.hasPassword ? 'Cambiar' : 'Guardar'}</button>
		</form>
		<button
			type="button"
			class="mt-3 text-sm font-semibold text-brand-700 hover:underline"
			onclick={generar}
		>
			Generar una contraseña segura
		</button>
		{#if form?.passwordErrors}
			<p class={ui.fieldError} role="alert">
				{form.passwordErrors.password ?? form.passwordErrors.confirm}
			</p>
		{/if}
	</section>

	<!-- Línea gráfica: viene del cliente -->
	<section class={ui.card} aria-labelledby="marca-titulo">
		<h2 id="marca-titulo" class={ui.sectionTitle}>Cliente y línea gráfica</h2>
		{#if a.client}
			<div class="mt-4 flex flex-wrap items-center gap-5">
				<div
					class="flex h-20 w-36 items-center justify-center rounded-xl border border-slate-200 bg-canvas p-3"
				>
					{#if a.logoUrl}
						<img
							src={a.logoUrl}
							alt="Logo del cliente"
							class="max-h-full max-w-full object-contain"
						/>
					{:else}
						<span class="text-xs text-slate-600">Sin logo</span>
					{/if}
				</div>
				<div class="flex flex-col gap-2">
					<p class="font-semibold">{a.client.name}</p>
					<div class="flex items-center gap-2 text-xs text-slate-600">
						<span
							class="h-5 w-5 rounded-md ring-1 ring-slate-300"
							style="background: {a.client.themePrimary ?? DEFAULT_PRIMARY}"
							aria-hidden="true"
						></span>
						<span
							class="h-5 w-5 rounded-md ring-1 ring-slate-300"
							style="background: {a.client.themeAccent ?? DEFAULT_ACCENT}"
							aria-hidden="true"
						></span>
						{a.client.themePrimary || a.client.themeAccent
							? 'Colores del cliente'
							: 'Colores de la plataforma'}
					</div>
				</div>
				<a
					href={resolve('/admin/(app)/clientes/[id]', { id: a.client.id })}
					class="{ui.btnSecondary} sm:ml-auto">Editar logo y colores del cliente</a
				>
			</div>
			<p class="mt-3 text-sm text-slate-600">
				Los cambios en el cliente se aplican a todos sus assessments. Para cambiar de cliente, use
				<em>Datos generales</em>.
			</p>
		{:else}
			<p class="mt-2 text-sm text-slate-600">
				Este assessment no tiene cliente: usa los colores de la plataforma y no muestra logo. Elija
				un cliente en <em>Datos generales</em> o
				<a href={resolve('/admin/(app)/clientes')} class="text-brand-700 underline">cree uno</a>.
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
			clients={data.clients}
			submitLabel="Guardar cambios"
		/>
	</section>

	<!-- Eliminación definitiva (pensada para assessments de prueba) -->
	<section class="rounded-2xl border border-red-200 bg-white p-6" aria-labelledby="eliminar-titulo">
		<h2 id="eliminar-titulo" class="text-base font-semibold text-red-800">Eliminar assessment</h2>
		<p class="mt-1 text-sm text-slate-700">
			Se borrarán para siempre el assessment y todo lo asociado:
			<strong>{data.deletion.questions}</strong>
			{data.deletion.questions === 1 ? 'pregunta' : 'preguntas'},
			<strong>{data.deletion.participants}</strong>
			{data.deletion.participants === 1 ? 'participante' : 'participantes'} y
			<strong>{data.deletion.submitted}</strong>
			{data.deletion.submitted === 1 ? 'entrega' : 'entregas'}, con sus respuestas, reportes y
			análisis. No se puede deshacer. Si solo quiere ocultarlo, use <em>Archivar</em>.
		</p>
		<form
			method="POST"
			action="?/eliminar"
			class="mt-4 flex flex-wrap items-end gap-3"
			use:enhance={({ cancel }) => {
				if (!confirm(`¿Eliminar definitivamente "${a.title}"? Esta acción no se puede deshacer.`)) {
					return cancel();
				}
			}}
		>
			<div class="min-w-64 flex-1">
				<label for="confirmacion" class={ui.label}>
					Para confirmar, escriba el título: <span class="font-semibold">{a.title}</span>
				</label>
				<input
					id="confirmacion"
					name="confirmacion"
					bind:value={confirmTitle}
					autocomplete="off"
					spellcheck="false"
					class={ui.input}
				/>
			</div>
			<button class={ui.btnDanger} disabled={confirmTitle.trim() !== a.title.trim()}>
				Eliminar definitivamente
			</button>
		</form>
		{#if form?.deleteError}
			<p class="mt-2 {ui.fieldError}" role="alert">{form.deleteError}</p>
		{/if}
	</section>
</div>
