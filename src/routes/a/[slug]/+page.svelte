<script lang="ts">
	import { enhance } from '$app/forms';
	import ClientLogo from '#lib/components/ClientLogo.svelte';
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

<!-- style: colores del cliente (variables de Tailwind), calculados en el servidor. -->
<div class="min-h-screen bg-canvas" style={a.themeStyle}>
	<!-- Encabezado con el logo del cliente -->
	<header class="bg-ink-950 px-5 pt-10 pb-20 text-white">
		<div class="mx-auto flex max-w-lg flex-col gap-4">
			<ClientLogo src={a.logoUrl} />
			<h1 class="font-display text-3xl leading-tight font-extrabold">{a.title}</h1>
			{#if a.description}
				<p class="text-[15px] leading-relaxed whitespace-pre-line text-ink-300">{a.description}</p>
			{/if}
			<p class="flex items-start gap-2 text-sm text-white">
				<svg
					class="mt-0.5 shrink-0"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
					><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"
					></path></svg
				>
				<span>
					Disponible del {formatLongDateTime(a.startsAt, a.timezone)} al {formatLongDateTime(
						a.endsAt,
						a.timezone
					)} (hora de {a.timezone.replaceAll('_', ' ')}).
				</span>
			</p>
		</div>
	</header>

	<main class="mx-auto -mt-12 max-w-lg px-4 pb-12">
		{#if data.availability !== 'abierto'}
			<div class="rounded-2xl bg-white p-6 shadow-lg shadow-ink-950/5" role="status">
				{#if data.availability === 'no_iniciado'}
					<p class="text-ink-950">
						<strong>Aún no está disponible.</strong> Podrá ingresar desde el
						{formatLongDateTime(a.startsAt, a.timezone)}.
					</p>
				{:else if data.availability === 'cerrado'}
					<p class="text-ink-950">
						<strong>Este assessment ya cerró.</strong> Ya no se reciben respuestas.
					</p>
				{:else}
					<p class="text-ink-950">Este assessment no está disponible.</p>
				{/if}
			</div>
		{:else}
			<form
				method="POST"
				class="flex flex-col gap-5 rounded-2xl bg-white p-6 shadow-lg shadow-ink-950/5"
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
						class="{ui.input} py-3 text-base"
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
						class="{ui.input} py-3 text-base"
					/>
				</div>

				{#if showName || form?.needName}
					<div>
						<label for="name" class={ui.label}>
							Nombre completo
							{#if !form?.needName}<span class="font-normal text-slate-600"
									>(si es su primer ingreso)</span
								>{/if}
						</label>
						<input
							id="name"
							name="name"
							autocomplete="name"
							required={form?.needName}
							defaultValue={form?.values?.name ?? ''}
							class="{ui.input} py-3 text-base"
						/>
					</div>
				{/if}

				<button type="submit" disabled={enviando} class="{ui.btnPrimary} w-full py-3.5 text-base">
					{enviando ? 'Ingresando…' : 'Ingresar'}
				</button>
			</form>

			<ul class="mt-6 flex flex-col gap-3 px-2 text-sm leading-relaxed text-slate-700">
				<li class="flex gap-3">
					<svg
						class="mt-0.5 shrink-0 text-brand-700"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path
							d="M17 21v-8H7v8M7 3v5h8"
						></path></svg
					>
					Sus respuestas se guardan automáticamente.
				</li>
				<li class="flex gap-3">
					<svg
						class="mt-0.5 shrink-0 text-brand-700"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg
					>
					Si sale, puede volver a ingresar con la misma contraseña y correo para continuar.
				</li>
				<li class="flex gap-3">
					<svg
						class="mt-0.5 shrink-0 text-brand-700"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><circle cx="12" cy="12" r="9"></circle><path d="M12 8v4M12 16h.01"></path></svg
					>
					Solo se permite una entrega por persona.
				</li>
			</ul>
		{/if}
	</main>
</div>
