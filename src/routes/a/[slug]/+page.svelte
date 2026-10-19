<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatLongDateTime } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const a = $derived(data.assessment);
	let enviando = $state(false);
	const showName = $derived(a.accessMode === 'abierto');
</script>

<svelte:head>
	<title>{a.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
	<h1 class="text-2xl font-semibold tracking-tight">{a.title}</h1>
	{#if a.description}
		<p class="mt-3 whitespace-pre-line text-slate-700">{a.description}</p>
	{/if}
	<p class="mt-3 text-sm text-slate-500">
		Disponible del {formatLongDateTime(a.startsAt, a.timezone)} al {formatLongDateTime(
			a.endsAt,
			a.timezone
		)} (hora de {a.timezone.replaceAll('_', ' ')}).
	</p>

	{#if data.availability === 'no_iniciado'}
		<p class="mt-8 {ui.alertWarning}" role="status">
			<strong>Aún no está disponible.</strong> Podrá ingresar desde el
			{formatLongDateTime(a.startsAt, a.timezone)}.
		</p>
	{:else if data.availability === 'cerrado'}
		<p class="mt-8 {ui.alertWarning}" role="status">
			<strong>Este assessment ya cerró.</strong> Ya no se reciben respuestas.
		</p>
	{:else if data.availability === 'no_disponible'}
		<p class="mt-8 {ui.alertWarning}" role="status">Este assessment no está disponible.</p>
	{:else}
		<form
			method="POST"
			class="mt-8 space-y-5 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200"
			use:enhance={({ formElement }) => {
				enviando = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'failure') {
						const pw = formElement.elements.namedItem('password');
						if (pw instanceof HTMLInputElement) pw.value = '';
					}
					enviando = false;
				};
			}}
		>
			{#if form?.error}
				<p role="alert" class={ui.alertError}>{form.error}</p>
			{/if}

			<div>
				<label for="password" class={ui.label}>Contraseña de acceso</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="off"
					required
					class={ui.input}
				/>
				<p class={ui.hint}>La que recibió en la invitación.</p>
			</div>

			<div>
				<label for="email" class={ui.label}>Su correo electrónico</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					defaultValue={form?.values?.email ?? ''}
					class={ui.input}
				/>
			</div>

			{#if showName || form?.needName}
				<div>
					<label for="name" class={ui.label}>
						Nombre completo
						{#if !form?.needName}<span class="font-normal text-slate-500"
								>(si es su primer ingreso)</span
							>{/if}
					</label>
					<input
						id="name"
						name="name"
						autocomplete="name"
						required={form?.needName}
						defaultValue={form?.values?.name ?? ''}
						class={ui.input}
					/>
				</div>
			{/if}

			<button type="submit" disabled={enviando} class="w-full {ui.btnPrimary}">
				{enviando ? 'Ingresando…' : 'Ingresar'}
			</button>
			<p class="text-xs text-slate-500">
				Sus respuestas se guardan automáticamente. Si sale, puede volver a ingresar con la misma
				contraseña y correo para continuar.
			</p>
		</form>
	{/if}
</main>
