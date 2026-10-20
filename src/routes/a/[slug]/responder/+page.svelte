<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import { formatLongDateTime } from '#lib/format.ts';
	import { ui } from '#lib/ui.ts';
	import ClientLogo from '#lib/components/ClientLogo.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const a = $derived(data.assessment);

	// ---- Respuestas en el navegador -----------------------------------------
	// Valor por pregunta: id de la opción elegida o el texto escrito.
	// svelte-ignore state_referenced_locally
	let values = $state<Record<string, string>>(
		Object.fromEntries(
			data.questions.map((q) => [
				q.id,
				data.answers[q.id]?.optionId ?? data.answers[q.id]?.text ?? ''
			])
		)
	);

	const answered = $derived(data.questions.filter((q) => values[q.id]?.trim()).length);

	// ---- Autoguardado -------------------------------------------------------
	type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
	let saveState = $state<SaveState>('idle');
	// svelte-ignore state_referenced_locally
	let lastSaved = $state<Date | null>(Object.keys(data.answers).length ? data.savedAt : null);
	let saveError = $state('');
	// Contabilidad interna del autoguardado: no se muestra, así que no necesita ser reactiva.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pending = new Map<string, string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let inFlight: Promise<void> | null = null;

	/** Envía al servidor los cambios pendientes (todas las preguntas modificadas a la vez). */
	async function flush(): Promise<void> {
		if (inFlight) await inFlight;
		if (pending.size === 0) return;

		const body = new FormData();
		for (const [id, v] of pending) body.append(`q_${id}`, v);
		const sent = new Map(pending);
		pending.clear();
		saveState = 'saving';

		inFlight = (async () => {
			try {
				const res = await fetch('?/guardar', {
					method: 'POST',
					body,
					headers: { 'x-sveltekit-action': 'true' }
				});
				const result = deserialize(await res.text());
				if (result.type === 'success') {
					saveState = pending.size ? 'pending' : 'saved';
					lastSaved = new Date();
					saveError = '';
				} else if (result.type === 'redirect') {
					// Sesión vencida, assessment cerrado o ya entregado: la URL la define el servidor.
					// eslint-disable-next-line svelte/no-navigation-without-resolve
					await goto(result.location);
				} else {
					const errors =
						result.type === 'failure' ? (result.data?.errors as string[] | undefined) : undefined;
					saveError = errors?.join(' ') ?? 'No se pudo guardar. Revise su conexión.';
					saveState = 'error';
					// Se reintentan los cambios en el próximo guardado.
					for (const [id, v] of sent) if (!pending.has(id)) pending.set(id, v);
				}
			} catch {
				saveError = 'Sin conexión. Sus cambios se guardarán al recuperarla.';
				saveState = 'error';
				for (const [id, v] of sent) if (!pending.has(id)) pending.set(id, v);
			} finally {
				inFlight = null;
			}
		})();
		await inFlight;
	}

	/** Programa el guardado: inmediato para opciones, con pausa de 1,5 s para texto. */
	function schedule(questionId: string, delayMs: number) {
		pending.set(questionId, values[questionId] ?? '');
		saveState = 'pending';
		clearTimeout(timers.get(questionId));
		timers.set(
			questionId,
			setTimeout(() => {
				timers.delete(questionId);
				void flush();
			}, delayMs)
		);
	}

	// Reintento periódico si hubo error de conexión.
	const retry = setInterval(() => {
		if (saveState === 'error' && pending.size) void flush();
	}, 10_000);
	onDestroy(() => {
		clearInterval(retry);
		for (const t of timers.values()) clearTimeout(t);
	});

	function onBeforeUnload(e: BeforeUnloadEvent) {
		if (pending.size || saveState === 'saving') e.preventDefault();
	}

	const statusText = $derived(
		{
			idle: lastSaved
				? `Guardado ${lastSaved.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
				: '',
			pending: 'Cambios sin guardar…',
			saving: 'Guardando…',
			saved: lastSaved
				? `Guardado ${lastSaved.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
				: 'Guardado',
			error: saveError
		}[saveState]
	);

	let entregando = $state(false);
	const missing = $derived(new Set<number>(form?.missing ?? []));
	const fmt = (n: number) => n.toLocaleString('es-CO');
	const percent = $derived(
		data.questions.length ? Math.round((answered / data.questions.length) * 100) : 0
	);

	// ---- Pasos de 3 preguntas -----------------------------------------------
	// Sin JavaScript se muestran todas las preguntas juntas: el formulario funciona igual.
	const PAGE_SIZE = 3;
	const pageCount = $derived(Math.max(1, Math.ceil(data.questions.length / PAGE_SIZE)));
	const pageOf = (i: number) => Math.floor(i / PAGE_SIZE);
	let step = $state(0);
	let paged = $state(false);
	onMount(() => (paged = true));
	const isLast = $derived(!paged || step >= pageCount - 1);
	const pages = $derived(
		Array.from({ length: pageCount }, (_, p) => {
			const qs = data.questions.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
			return { answered: qs.filter((q) => values[q.id]?.trim()).length, total: qs.length };
		})
	);
	const firstOnPage = $derived(step * PAGE_SIZE + 1);
	const lastOnPage = $derived(Math.min((step + 1) * PAGE_SIZE, data.questions.length));
	let stepHeading = $state<HTMLElement>();

	async function goTo(p: number) {
		if (p === step || p < 0 || p >= pageCount) return;
		void flush(); // Guarda lo pendiente del paso que se deja.
		step = p;
		await tick();
		window.scrollTo({ top: 0, behavior: 'smooth' });
		stepHeading?.focus({ preventScroll: true });
	}

	// Si la entrega falla por preguntas obligatorias, se muestra el paso de la primera que falta.
	$effect(() => {
		const first = form?.missing?.[0];
		if (first) step = pageOf(first - 1);
	});

	// Anillo de avance del banner.
	const RING = 2 * Math.PI * 26;
</script>

<svelte:window onbeforeunload={onBeforeUnload} />

<svelte:head>
	<title>{a.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<!-- style: colores del cliente (variables de Tailwind), calculados en el servidor. -->
<div class="min-h-screen" style={a.themeStyle}>
	<!-- Banner del cliente: color principal, logo grande y avance general. -->
	<header class="bg-ink-950 text-white">
		<div
			class="mx-auto flex max-w-3xl flex-col items-start gap-4 px-4 pt-7 pb-14 sm:flex-row sm:items-center sm:gap-6 sm:pt-9 sm:pb-16"
		>
			<span class="shrink-0"><ClientLogo src={a.logoUrl} size="lg" /></span>
			<div class="min-w-0 flex-1">
				<h1 class="font-display text-xl leading-tight font-extrabold sm:text-3xl">{a.title}</h1>
				<p class="mt-2 text-sm text-ink-300">
					Hola, {data.participant.name} · Cierra el {formatLongDateTime(a.endsAt, a.timezone)}
				</p>
			</div>
			<div class="relative hidden h-16 w-16 shrink-0 sm:block" aria-hidden="true">
				<svg viewBox="0 0 60 60" class="h-16 w-16 -rotate-90">
					<circle
						cx="30"
						cy="30"
						r="26"
						fill="none"
						stroke="currentColor"
						stroke-width="6"
						class="text-white/20"
					/>
					<circle
						cx="30"
						cy="30"
						r="26"
						fill="none"
						stroke="currentColor"
						stroke-width="6"
						stroke-linecap="round"
						stroke-dasharray={RING}
						stroke-dashoffset={RING * (1 - percent / 100)}
						class="text-white transition-all duration-500"
					/>
				</svg>
				<span class="absolute inset-0 flex items-center justify-center text-sm font-bold"
					>{percent}%</span
				>
			</div>
		</div>
	</header>

	<main class="mx-auto -mt-9 max-w-3xl px-4 pb-10">
		<!-- Tarjeta de pasos: queda fija arriba al bajar, con el estado del guardado. -->
		<div
			class="sticky top-2 z-10 mb-6 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur"
		>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<p class="text-sm font-semibold">
					{#if paged && pageCount > 1}Paso {step + 1} de {pageCount}{:else}Sus respuestas{/if}
				</p>
				{#if paged && pageCount > 1}
					<ol class="flex min-w-32 flex-1 gap-1.5" aria-label="Pasos">
						{#each pages as p, n (n)}
							<li class="flex-1">
								<button
									type="button"
									onclick={() => goTo(n)}
									aria-label="Ir al paso {n + 1} ({p.answered} de {p.total} respondidas)"
									aria-current={n === step ? 'step' : undefined}
									class="block w-full py-1.5"
								>
									<span
										class="block h-2 overflow-hidden rounded-full bg-slate-200 {n === step
											? 'ring-2 ring-brand-300'
											: ''}"
									>
										<span
											class="block h-2 rounded-full bg-brand-600 transition-all"
											style="width: {(p.answered / p.total) * 100}%"
										></span>
									</span>
								</button>
							</li>
						{/each}
					</ol>
				{:else}
					<div
						class="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-slate-200"
						aria-hidden="true"
					>
						<div
							class="h-2 rounded-full bg-brand-600 transition-all"
							style="width: {percent}%"
						></div>
					</div>
				{/if}
				<p
					class="inline-flex shrink-0 items-center gap-1.5 text-xs {saveState === 'error'
						? 'text-red-700'
						: 'text-slate-600'}"
					role="status"
					aria-live="polite"
				>
					{#if saveState === 'saved' || saveState === 'idle'}
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.6"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="text-brand-600"
							aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg
						>
					{/if}
					{statusText}
				</p>
			</div>
			<p class="mt-1 text-xs text-slate-600">
				{data.participant.name} · {answered} de {data.questions.length} respondidas
			</p>
		</div>

		{#if paged && pageCount > 1}
			<h2
				bind:this={stepHeading}
				tabindex="-1"
				class="mb-4 text-xs font-semibold tracking-wider text-slate-600 uppercase outline-none"
			>
				Preguntas {firstOnPage}{lastOnPage > firstOnPage ? ` a ${lastOnPage}` : ''} de {data
					.questions.length}
			</h2>
		{/if}

		{#if a.instructions && (!paged || step === 0)}
			<section class="mb-6 rounded-2xl bg-ink-950 p-6 text-white" aria-labelledby="instr">
				<h2 id="instr" class="text-xs font-semibold tracking-wider text-ink-300 uppercase">
					Instrucciones
				</h2>
				<p class="mt-2 text-[15px] leading-relaxed whitespace-pre-line">{a.instructions}</p>
			</section>
		{/if}
		{#if !paged || step === 0}
			<p class="mb-6 text-sm text-slate-600">
				Las preguntas marcadas con
				<span class="text-red-600" aria-hidden="true">*</span><span class="sr-only">asterisco</span>
				son obligatorias. Sus respuestas se guardan solas mientras avanza.
			</p>
		{/if}

		<form
			method="POST"
			action="?/entregar"
			use:enhance={({ cancel }) => {
				if (
					!confirm(
						'¿Entregar sus respuestas? Una vez entregadas no podrá modificarlas ni volver a responder.'
					)
				) {
					return cancel();
				}
				entregando = true;
				// Los temporizadores pendientes ya no hacen falta: el formulario envía todo.
				for (const t of timers.values()) clearTimeout(t);
				timers.clear();
				pending.clear();
				return async ({ update }) => {
					await update({ reset: false });
					entregando = false;
				};
			}}
		>
			<ol class="space-y-6">
				{#each data.questions as q, i (q.id)}
					<li
						hidden={paged && pageOf(i) !== step}
						id="pregunta-{i + 1}"
						class="scroll-mt-24 rounded-2xl border bg-white p-5 sm:p-6 {missing.has(i + 1)
							? 'border-red-300 ring-2 ring-red-200'
							: 'border-slate-200'}"
					>
						{#if q.type === 'opcion_unica'}
							<fieldset>
								<legend class="font-display text-lg leading-snug font-bold">
									<span class="text-brand-700">{i + 1}.</span>
									<span class="whitespace-pre-line">{q.prompt}</span>
									{#if q.required}<span class="text-red-600" aria-hidden="true"> *</span><span
											class="sr-only">(obligatoria)</span
										>{:else}<span class="text-sm font-normal text-slate-500"> (opcional)</span>{/if}
								</legend>
								<div class="mt-4 space-y-2.5">
									{#each q.options as o (o.id)}
										<label
											class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-300 px-4 py-3.5 text-[15px] hover:bg-slate-50 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:font-semibold has-[:checked]:ring-1 has-[:checked]:ring-brand-600"
										>
											<input
												type="radio"
												name="q_{q.id}"
												value={o.id}
												bind:group={values[q.id]}
												onchange={() => schedule(q.id, 0)}
												class="mt-0.5 text-brand-600 focus:ring-brand-500"
											/>
											<span>{o.text}</span>
										</label>
									{/each}
								</div>
							</fieldset>
						{:else}
							<label for="q-{q.id}" class="mb-3 block font-display text-lg leading-snug font-bold">
								<span class="text-brand-700">{i + 1}.</span>
								<span class="whitespace-pre-line">{q.prompt}</span>
								{#if q.required}<span class="text-red-600" aria-hidden="true"> *</span><span
										class="sr-only">(obligatoria)</span
									>{:else}<span class="text-sm font-normal text-slate-500"> (opcional)</span>{/if}
							</label>
							<textarea
								id="q-{q.id}"
								name="q_{q.id}"
								rows="8"
								maxlength={a.openMaxChars}
								bind:value={values[q.id]}
								oninput={() => schedule(q.id, 1500)}
								onblur={() => {
									if (pending.has(q.id)) void flush();
								}}
								aria-describedby="contador-{q.id}"
								class="{ui.input} resize-y"></textarea>
							<p
								id="contador-{q.id}"
								class="mt-1 text-right text-xs tabular-nums {(values[q.id]?.length ?? 0) >=
								a.openMaxChars * 0.95
									? 'text-amber-700'
									: 'text-slate-500'}"
							>
								{fmt(values[q.id]?.length ?? 0)} / {fmt(a.openMaxChars)} caracteres
							</p>
						{/if}
					</li>
				{/each}
			</ol>

			{#if form?.errors}
				<div class="mt-6 {ui.alertError}" role="alert">
					{#each form.errors as e (e)}<p>{e}</p>{/each}
				</div>
			{/if}

			<div class="mt-8 flex flex-wrap items-center gap-3">
				{#if paged && step > 0}
					<button type="button" class={ui.btnSecondary} onclick={() => goTo(step - 1)}
						>← Anterior</button
					>
				{/if}
				<span class="flex-1"></span>
				{#if !paged}
					<!-- Sin JavaScript no hay autoguardado: este botón guarda el borrador. -->
					<button type="submit" formaction="?/guardar" class={ui.btnSecondary}
						>Guardar borrador</button
					>
				{/if}
				{#if isLast}
					<button type="submit" class={ui.btnPrimary} disabled={entregando}>
						{entregando ? 'Entregando…' : 'Entregar respuestas'}
					</button>
				{:else}
					<button type="button" class={ui.btnPrimary} onclick={() => goTo(step + 1)}
						>Siguiente →</button
					>
				{/if}
			</div>
		</form>
	</main>
</div>
