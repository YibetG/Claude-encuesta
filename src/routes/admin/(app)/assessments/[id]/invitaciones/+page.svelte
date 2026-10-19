<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { renderTemplate } from '#lib/invite-template.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const a = $derived(data.assessment);

	// Plantilla editable con vista previa en vivo.
	// svelte-ignore state_referenced_locally
	let subject = $state(form?.templateValues?.subject ?? data.template.subject);
	// svelte-ignore state_referenced_locally
	let body = $state(form?.templateValues?.body ?? data.template.body);
	const preview = $derived({
		subject: renderTemplate(subject, data.previewVars),
		body: renderTemplate(body, data.previewVars)
	});

	let enviando = $state(false);
	let copiado = $state(false);

	async function copiar(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiado = true;
			setTimeout(() => (copiado = false), 2000);
		} catch {
			copiado = false;
		}
	}

	const generalHref = $derived(resolve('/admin/(app)/assessments/[id]', { id: a.id }));
	const participantsHref = $derived(
		resolve('/admin/(app)/assessments/[id]/participantes', { id: a.id })
	);
</script>

<svelte:head>
	<title>Invitaciones · {a.title}</title>
</svelte:head>

<div class="space-y-6">
	{#if !a.hasPassword}
		<p class={ui.alertWarning}>
			Defina la contraseña de acceso en <a href={generalHref} class="underline">General</a> antes de invitar.
		</p>
	{/if}

	<!-- Plantilla -->
	<section class={ui.card} aria-labelledby="tpl-titulo">
		<h2 id="tpl-titulo" class="text-base font-semibold">Plantilla del mensaje</h2>
		<p class="mt-1 text-sm text-slate-600">
			Use estas variables; se reemplazan para cada participante:
		</p>
		<ul class="mt-2 flex flex-wrap gap-2 text-xs">
			{#each Object.entries(data.placeholders) as [key, label] (key)}
				<li class="rounded bg-slate-100 px-2 py-1" title={label}>
					<code>{`{{${key}}}`}</code> <span class="text-slate-500">{label}</span>
				</li>
			{/each}
		</ul>

		<div class="mt-4 grid gap-6 lg:grid-cols-2">
			<form
				method="POST"
				action="?/plantilla"
				class="space-y-3"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<div>
					<label for="subject" class={ui.label}>Asunto</label>
					<input
						id="subject"
						name="subject"
						bind:value={subject}
						maxlength="200"
						class={ui.input}
					/>
					{#if form?.templateErrors?.subject}
						<p class={ui.fieldError}>{form.templateErrors.subject}</p>
					{/if}
				</div>
				<div>
					<label for="body" class={ui.label}>Mensaje</label>
					<textarea
						id="body"
						name="body"
						bind:value={body}
						rows="14"
						maxlength="5000"
						class="{ui.input} font-mono text-xs"></textarea>
					{#if form?.templateErrors?.body}
						<p class={ui.fieldError} role="alert">{form.templateErrors.body}</p>
					{/if}
				</div>
				<div class="flex items-center gap-3">
					<button class={ui.btnPrimary}>Guardar plantilla</button>
					{#if form?.templateSaved}<span class="text-sm text-emerald-700" role="status"
							>Plantilla guardada.</span
						>{/if}
				</div>
			</form>

			<div>
				<p class={ui.label}>Vista previa</p>
				<div class="mt-1 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
					<p><span class="text-slate-500">Asunto:</span> <strong>{preview.subject}</strong></p>
					<hr class="my-3 border-slate-200" />
					<p class="whitespace-pre-line">{preview.body}</p>
				</div>
			</div>
		</div>
	</section>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Envío por correo -->
		<section class={ui.card} aria-labelledby="enviar-titulo">
			<h2 id="enviar-titulo" class="text-base font-semibold">Enviar por correo</h2>
			{#if data.mailerKind === 'consola'}
				<p class="mt-2 {ui.alertWarning}">
					No hay servidor SMTP configurado: los correos se mostrarán en la consola del servidor
					(modo de desarrollo). Configure <code>SMTP_HOST</code> en <code>.env</code> para enviarlos.
				</p>
			{/if}
			{#if a.status !== 'publicado'}
				<p class="mt-2 {ui.alertWarning}">
					El assessment no está publicado. Publíquelo en
					<a href={generalHref} class="underline">General</a> para poder enviar invitaciones.
				</p>
			{/if}

			<form
				method="POST"
				action="?/enviar"
				class="mt-4 space-y-4"
				use:enhance={({ cancel }) => {
					if (!confirm('¿Enviar las invitaciones ahora?')) return cancel();
					enviando = true;
					return async ({ update }) => {
						await update();
						enviando = false;
					};
				}}
			>
				<fieldset>
					<legend class={ui.label}>Destinatarios</legend>
					<div class="mt-2 space-y-2 text-sm">
						<label class="flex items-center gap-2">
							<input
								type="radio"
								name="destinatarios"
								value="sin_invitar"
								checked
								class="text-indigo-600"
							/>
							Quienes aún no han recibido invitación ({data.recipientCounts.sin_invitar})
						</label>
						<label class="flex items-center gap-2">
							<input
								type="radio"
								name="destinatarios"
								value="no_completados"
								class="text-indigo-600"
							/>
							Todos los que no han entregado ({data.recipientCounts.no_completados}) — recordatorio
						</label>
					</div>
				</fieldset>
				<div>
					<label for="send-password" class={ui.label}>Contraseña de acceso vigente</label>
					<input
						id="send-password"
						name="password"
						type="password"
						autocomplete="off"
						required
						class={ui.input}
					/>
					<p class={ui.hint}>
						Se guarda cifrada y no se puede consultar: escríbala para incluirla en el mensaje.
					</p>
				</div>
				<button class={ui.btnPrimary} disabled={enviando || a.status !== 'publicado'}>
					{enviando ? 'Enviando…' : 'Enviar invitaciones'}
				</button>
			</form>

			{#if form?.sendError}
				<p class="mt-3 {ui.alertError}" role="alert">{form.sendError}</p>
			{/if}
			{#if form?.sendResult}
				<p class="mt-3 {form.sendResult.failed ? ui.alertWarning : ui.alertSuccess}" role="status">
					Se enviaron {form.sendResult.sent} de {form.sendResult.total} invitaciones.
					{#if form.sendResult.failed}
						{form.sendResult.failed} fallaron: revise la columna "Invitación" en
						<a href={participantsHref} class="underline">Participantes</a>.
					{/if}
				</p>
			{/if}
		</section>

		<!-- Copiar mensaje -->
		<section class={ui.card} aria-labelledby="copiar-titulo">
			<h2 id="copiar-titulo" class="text-base font-semibold">Copiar mensaje</h2>
			<p class="mt-1 text-sm text-slate-600">
				Genera un mensaje general (sin nombre) para enviarlo por chat u otro medio.
			</p>
			<form method="POST" action="?/copiar" class="mt-4 flex flex-wrap items-end gap-3" use:enhance>
				<div class="grow">
					<label for="copy-password" class={ui.label}>Contraseña de acceso vigente</label>
					<input
						id="copy-password"
						name="password"
						type="password"
						autocomplete="off"
						required
						class={ui.input}
					/>
				</div>
				<button class={ui.btnSecondary}>Generar mensaje</button>
			</form>
			{#if form?.copyError}
				<p class="mt-3 {ui.alertError}" role="alert">{form.copyError}</p>
			{/if}
			{#if form?.generic}
				{@const texto = `${form.generic.subject}\n\n${form.generic.body}`}
				<label for="generic" class="mt-4 {ui.label}">Mensaje</label>
				<textarea id="generic" readonly rows="12" class="{ui.input} text-xs">{texto}</textarea>
				<button type="button" class="mt-2 {ui.btnSecondary}" onclick={() => copiar(texto)}>
					{copiado ? 'Copiado' : 'Copiar al portapapeles'}
				</button>
			{/if}
		</section>
	</div>
</div>
