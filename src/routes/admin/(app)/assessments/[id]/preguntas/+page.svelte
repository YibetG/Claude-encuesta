<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { QUESTION_TYPE_LABELS, type QuestionType } from '#lib/constants.ts';
	import { MAX_OPTIONS, MIN_OPTIONS } from '#lib/schemas/question.ts';
	import { ui } from '#lib/ui.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// ---- Estado local del editor ------------------------------------------
	// Cada pregunta y opción lleva una `key` local estable para el {#each} y los ids de los inputs.
	type EditOption = { key: string; text: string; isCorrect: boolean };
	type EditQuestion = {
		key: string;
		type: QuestionType;
		prompt: string;
		required: boolean;
		options: EditOption[];
	};

	const newKey = () => crypto.randomUUID();
	const blankOptions = (): EditOption[] =>
		Array.from({ length: MIN_OPTIONS }, (_, i) => ({
			key: newKey(),
			text: '',
			isCorrect: i === 0
		}));

	function fromData(): EditQuestion[] {
		return data.questions.map((q) => ({
			key: newKey(),
			type: q.type,
			prompt: q.prompt,
			required: q.required,
			options: q.options.map((o) => ({ key: newKey(), text: o.text, isCorrect: o.isCorrect }))
		}));
	}

	/** Lo que se envía al servidor (sin las keys locales). */
	function toPayload(list: EditQuestion[]) {
		return list.map((q) =>
			q.type === 'opcion_unica'
				? {
						type: q.type,
						prompt: q.prompt,
						required: q.required,
						options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect }))
					}
				: { type: q.type, prompt: q.prompt, required: q.required }
		);
	}

	let questions = $state<EditQuestion[]>(fromData());
	let savedJson = $state(JSON.stringify(toPayload(fromData())));
	const payloadJson = $derived(JSON.stringify(toPayload(questions)));
	const dirty = $derived(payloadJson !== savedJson);
	let guardando = $state(false);

	const counts = $derived({
		choice: questions.filter((q) => q.type === 'opcion_unica').length,
		open: questions.filter((q) => q.type === 'abierta').length
	});

	function resetFromServer() {
		questions = fromData();
		savedJson = JSON.stringify(toPayload(questions));
	}

	async function addQuestion(type: QuestionType) {
		const q: EditQuestion = {
			key: newKey(),
			type,
			prompt: '',
			required: true,
			options: type === 'opcion_unica' ? blankOptions() : []
		};
		questions.push(q);
		await tick();
		document.getElementById(`prompt-${q.key}`)?.focus();
	}

	function removeQuestion(i: number) {
		const q = questions[i];
		if (q.prompt.trim() && !confirm(`¿Eliminar la pregunta ${i + 1}?`)) return;
		questions.splice(i, 1);
	}

	function move(i: number, delta: -1 | 1) {
		const j = i + delta;
		if (j < 0 || j >= questions.length) return;
		[questions[i], questions[j]] = [questions[j], questions[i]];
	}

	function setCorrect(q: EditQuestion, key: string) {
		for (const o of q.options) o.isCorrect = o.key === key;
	}

	async function addOption(q: EditQuestion) {
		const o = { key: newKey(), text: '', isCorrect: false };
		q.options.push(o);
		await tick();
		document.getElementById(`option-${o.key}`)?.focus();
	}

	function removeOption(q: EditQuestion, key: string) {
		const wasCorrect = q.options.find((o) => o.key === key)?.isCorrect;
		q.options = q.options.filter((o) => o.key !== key);
		if (wasCorrect && q.options.length) q.options[0].isCorrect = true;
	}

	// Aviso al salir con cambios sin guardar.
	beforeNavigate(({ cancel, type }) => {
		// Al cerrar o recargar la pestaña ('leave') el navegador muestra su propio aviso
		// (ver onBeforeUnload); confirm() no está permitido en ese momento.
		if (!dirty || type === 'form' || type === 'leave') return;
		if (!confirm('Hay cambios sin guardar. ¿Salir de todas formas?')) cancel();
	});

	function onBeforeUnload(e: BeforeUnloadEvent) {
		if (dirty) e.preventDefault();
	}

	const generalHref = $derived(
		resolve('/admin/(app)/assessments/[id]', { id: data.assessment.id })
	);
	const templateHref = $derived(
		resolve('/admin/(app)/assessments/[id]/preguntas/plantilla', { id: data.assessment.id })
	);
	const wordTemplateHref = $derived(
		resolve('/admin/(app)/assessments/[id]/preguntas/plantilla-word', { id: data.assessment.id })
	);

	// ---- Importación desde Word: vista previa → se carga en el editor sin guardar ----
	type WordPreview = {
		fileName: string;
		questions: {
			type: QuestionType;
			prompt: string;
			required: boolean;
			options: { text: string; isCorrect: boolean }[];
		}[];
		warnings: string[];
	};
	let preview = $state<WordPreview | null>(null);
	let wordErrors = $state<string[]>([]);
	let leyendo = $state(false);
	let loadedNotice = $state('');

	// Si el formulario se envió antes de que cargara JavaScript, el resultado llega en `form`.
	$effect(() => {
		if (form?.word) preview = form.word;
		if (form?.wordErrors) wordErrors = form.wordErrors;
	});

	const previewCounts = $derived({
		choice: preview?.questions.filter((q) => q.type === 'opcion_unica').length ?? 0,
		open: preview?.questions.filter((q) => q.type === 'abierta').length ?? 0
	});

	async function applyPreview(mode: 'agregar' | 'reemplazar') {
		if (!preview) return;
		if (
			mode === 'reemplazar' &&
			questions.length &&
			!confirm(`¿Reemplazar las ${questions.length} preguntas del editor por las del documento?`)
		) {
			return;
		}
		const loaded: EditQuestion[] = preview.questions.map((q) => ({
			key: newKey(),
			type: q.type,
			prompt: q.prompt,
			required: q.required,
			options:
				q.type === 'opcion_unica'
					? q.options.map((o) => ({ key: newKey(), text: o.text, isCorrect: o.isCorrect }))
					: []
		}));
		const firstIndex = mode === 'agregar' ? questions.length : 0;
		questions = mode === 'agregar' ? [...questions, ...loaded] : loaded;
		loadedNotice = `Se cargaron ${loaded.length} preguntas del documento en el editor. Revíselas y pulse "Guardar preguntas" para guardarlas.`;
		preview = null;
		await tick();
		document.getElementById(`pregunta-${firstIndex + 1}`)?.scrollIntoView({ block: 'start' });
	}

	/** Lo que el editor no dejaría guardar en una pregunta de selección. */
	function reviewHint(q: EditQuestion): string | null {
		if (q.type !== 'opcion_unica') return null;
		if (q.options.length < MIN_OPTIONS) return `Necesita al menos ${MIN_OPTIONS} opciones.`;
		if (q.options.length > MAX_OPTIONS) return `Puede tener máximo ${MAX_OPTIONS} opciones.`;
		if (q.options.filter((o) => o.isCorrect).length !== 1) return 'Marque la opción correcta.';
		return null;
	}
</script>

<svelte:window onbeforeunload={onBeforeUnload} />

<svelte:head>
	<title>Preguntas · {data.assessment.title}</title>
</svelte:head>

{#if page.url.searchParams.get('creado') === '1' && data.questions.length === 0}
	<p class="mb-6 {ui.alertSuccess}" role="status">
		Assessment creado. Ahora agregue las preguntas o impórtelas desde Word o Excel.
	</p>
{/if}

{#if data.locked}
	<!-- Vista de solo lectura: ya hay respuestas o el assessment es parte de una serie -->
	<div class="{ui.alertWarning} flex flex-wrap items-center justify-between gap-3">
		<p>{data.lockReason}</p>
		<form method="POST" action="{generalHref}?/duplicar">
			<button class={ui.btnSecondary}>Duplicar assessment</button>
		</form>
	</div>

	<ol class="mt-6 space-y-4">
		{#each data.questions as q, i (q.id)}
			<li class={ui.card}>
				<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">
					Pregunta {i + 1} · {QUESTION_TYPE_LABELS[q.type]}{q.required ? '' : ' · Opcional'}
				</p>
				<p class="mt-1 whitespace-pre-line">{q.prompt}</p>
				{#if q.type === 'opcion_unica'}
					<ul class="mt-3 space-y-1 text-sm">
						{#each q.options as o (o.id)}
							<li class={o.isCorrect ? 'font-medium text-emerald-800' : 'text-slate-700'}>
								{o.isCorrect ? '✓' : '○'}
								{o.text}
								{#if o.isCorrect}<span class="sr-only">(opción correcta)</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ol>
{:else}
	<!-- Importación desde Word -->
	<section class={ui.card} aria-labelledby="word-titulo">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 id="word-titulo" class="text-sm font-semibold">Importar preguntas desde Word</h2>
				<p class="mt-1 max-w-2xl text-sm text-slate-600">
					Numere cada pregunta (1., 2., …), ponga sus opciones debajo con letras (a), b), …) y
					<u>subraye</u> o <mark class="bg-yellow-200 px-0.5">resalte</mark> la respuesta correcta.
					Una pregunta sin opciones queda como abierta; escriba <em>(opcional)</em> al final si no es
					obligatoria.
				</p>
			</div>
			<a href={wordTemplateHref} class="{ui.btnSecondary} shrink-0" download>
				Descargar plantilla Word
			</a>
		</div>

		<form
			method="POST"
			action="?/leerWord"
			enctype="multipart/form-data"
			class="mt-4 flex flex-wrap items-end gap-4"
			use:enhance={() => {
				leyendo = true;
				wordErrors = [];
				preview = null;
				return async ({ result }) => {
					leyendo = false;
					if (result.type === 'success') {
						preview = (result.data?.word as WordPreview | undefined) ?? null;
					} else if (result.type === 'failure') {
						wordErrors = (result.data?.wordErrors as string[] | undefined) ?? [
							'No se pudo leer el documento.'
						];
					} else {
						wordErrors = ['No se pudo leer el documento. Intente de nuevo.'];
					}
				};
			}}
		>
			<div>
				<label for="documento" class={ui.label}>Documento (.docx, máx. 10 MB)</label>
				<input
					id="documento"
					name="documento"
					type="file"
					accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
					required
					class="mt-1 block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
				/>
			</div>
			<button class={ui.btnPrimary} disabled={leyendo}>
				{leyendo ? 'Leyendo…' : 'Leer documento'}
			</button>
		</form>

		{#if wordErrors.length}
			<div class="mt-4 {ui.alertError}" role="alert">
				{#each wordErrors as e (e)}<p>{e}</p>{/each}
			</div>
		{/if}

		{#if preview}
			<div class="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-live="polite">
				<p class="text-sm">
					<strong>Vista previa:</strong> se leyeron {preview.questions.length} preguntas de
					<span class="font-medium">{preview.fileName}</span> ({previewCounts.choice} de selección · {previewCounts.open}
					abiertas). Todavía no se ha guardado nada.
				</p>

				{#if preview.warnings.length}
					<div class="mt-3 {ui.alertWarning}">
						<p class="font-medium">
							Revise {preview.warnings.length === 1 ? 'esto' : 'estos puntos'}:
						</p>
						<ul class="mt-1 list-disc pl-5">
							{#each preview.warnings as w (w)}<li>{w}</li>{/each}
						</ul>
					</div>
				{/if}

				<ol class="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
					{#each preview.questions as q, i (i)}
						<li class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
							<p class="font-medium">
								<span class="text-slate-500">{i + 1}.</span>
								<span class="whitespace-pre-line">{q.prompt}</span>
								<span class="ml-1 text-xs font-normal text-slate-500"
									>{QUESTION_TYPE_LABELS[q.type]}{q.required ? '' : ' · Opcional'}</span
								>
							</p>
							{#if q.type === 'opcion_unica'}
								<ul class="mt-1 space-y-0.5 pl-4">
									{#each q.options as o, j (j)}
										<li class={o.isCorrect ? 'font-medium text-emerald-800' : 'text-slate-700'}>
											{o.isCorrect ? '✓' : '○'}
											{o.text}
											{#if o.isCorrect}<span class="sr-only">(opción correcta)</span>{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ol>

				<div class="mt-4 flex flex-wrap gap-2">
					<button type="button" class={ui.btnPrimary} onclick={() => applyPreview('agregar')}>
						{questions.length ? 'Agregar al final del editor' : 'Cargar en el editor'}
					</button>
					{#if questions.length}
						<button
							type="button"
							class={ui.btnSecondary}
							onclick={() => applyPreview('reemplazar')}
						>
							Reemplazar las del editor
						</button>
					{/if}
					<button type="button" class={ui.btnSecondary} onclick={() => (preview = null)}>
						Descartar
					</button>
				</div>
			</div>
		{/if}
	</section>

	<!-- Importación desde Excel -->
	<details class="mt-4 {ui.card} group" open={!!form?.importErrors || !!form?.imported}>
		<summary class="cursor-pointer text-sm font-semibold"
			>Importar preguntas desde Excel o CSV</summary
		>
		<div class="mt-4 space-y-4 text-sm">
			<p class="text-slate-600">
				Descargue la <a href={templateHref} class="text-brand-600 underline" download
					>plantilla de Excel</a
				>, complétela y súbala. Si alguna fila tiene errores no se importa nada y se indica el
				detalle.
			</p>
			{#if dirty}
				<p class={ui.alertWarning}>
					Tiene cambios sin guardar en el editor: guárdelos antes de importar o se perderán.
				</p>
			{/if}
			<form
				method="POST"
				action="?/importar"
				enctype="multipart/form-data"
				class="flex flex-wrap items-end gap-4"
				use:enhance={() =>
					async ({ result, update }) => {
						await update();
						if (result.type === 'success') resetFromServer();
					}}
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
				<fieldset class="flex gap-4">
					<legend class="sr-only">Modo de importación</legend>
					<label class="flex items-center gap-1.5">
						<input type="radio" name="modo" value="agregar" checked class="text-brand-600" />
						Agregar al final
					</label>
					<label class="flex items-center gap-1.5">
						<input type="radio" name="modo" value="reemplazar" class="text-brand-600" />
						Reemplazar todas
					</label>
				</fieldset>
				<button class={ui.btnSecondary}>Importar</button>
			</form>

			{#if form?.importErrors}
				<div class={ui.alertError} role="alert">
					<p class="font-medium">No se importó ninguna pregunta:</p>
					<ul class="mt-1 max-h-60 list-disc overflow-y-auto pl-5">
						{#each form.importErrors as e (e)}<li>{e}</li>{/each}
					</ul>
				</div>
			{/if}
			{#if form?.imported}
				<p class={ui.alertSuccess} role="status">
					Se importaron {form.imported} preguntas.
				</p>
			{/if}
		</div>
	</details>

	<!-- Editor -->
	<form
		method="POST"
		action="?/guardar"
		class="mt-6"
		use:enhance={() => {
			guardando = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') resetFromServer();
				guardando = false;
			};
		}}
	>
		<input type="hidden" name="payload" value={payloadJson} />

		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-slate-600" aria-live="polite">
				{questions.length}
				{questions.length === 1 ? 'pregunta' : 'preguntas'}: {counts.choice} de selección
				{#if questions.length}({Math.round((counts.choice / questions.length) * 100)}%){/if} · {counts.open}
				abiertas
			</p>
		</div>

		{#if form?.errors}
			<div class="mt-4 {ui.alertError}" role="alert">
				<p class="font-medium">Revise lo siguiente antes de guardar:</p>
				<ul class="mt-1 list-disc pl-5">
					{#each form.errors as e (e)}<li>{e}</li>{/each}
				</ul>
			</div>
		{/if}
		{#if form?.saved !== undefined && !dirty}
			<p class="mt-4 {ui.alertSuccess}" role="status">Preguntas guardadas.</p>
		{:else if loadedNotice && dirty}
			<p class="mt-4 {ui.alertWarning}" role="status">{loadedNotice}</p>
		{/if}

		{#if questions.length === 0}
			<p class="mt-6 {ui.card} text-center text-slate-600">
				Todavía no hay preguntas. Agregue una con los botones de abajo.
			</p>
		{/if}

		<ol class="mt-4 space-y-4">
			{#each questions as q, i (q.key)}
				{@const hint = reviewHint(q)}
				<li
					id="pregunta-{i + 1}"
					class="{ui.card} scroll-mt-4 {hint ? 'ring-2 ring-amber-300' : ''}"
				>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">
							Pregunta {i + 1} · {QUESTION_TYPE_LABELS[q.type]}
						</p>
						<div class="flex items-center gap-1">
							<button
								type="button"
								class={ui.btnIcon}
								onclick={() => move(i, -1)}
								disabled={i === 0}
								aria-label="Subir pregunta {i + 1}">↑</button
							>
							<button
								type="button"
								class={ui.btnIcon}
								onclick={() => move(i, 1)}
								disabled={i === questions.length - 1}
								aria-label="Bajar pregunta {i + 1}">↓</button
							>
							<button
								type="button"
								class="{ui.btnIcon} hover:text-red-700"
								onclick={() => removeQuestion(i)}
								aria-label="Eliminar pregunta {i + 1}">✕</button
							>
						</div>
					</div>

					<label for="prompt-{q.key}" class="sr-only">Enunciado de la pregunta {i + 1}</label>
					<textarea
						id="prompt-{q.key}"
						bind:value={q.prompt}
						rows="2"
						maxlength="2000"
						placeholder="Escriba el enunciado…"
						class={ui.input}></textarea>

					<label class="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
						<input type="checkbox" bind:checked={q.required} class="rounded text-brand-600" />
						Obligatoria
					</label>

					{#if q.type === 'opcion_unica'}
						<fieldset class="mt-3">
							<legend class="text-sm font-medium text-slate-700">
								Opciones <span class="font-normal text-slate-500">(marque la correcta)</span>
							</legend>
							<ul class="mt-2 space-y-2">
								{#each q.options as o, j (o.key)}
									<li class="flex items-center gap-2">
										<input
											type="radio"
											name="correcta-{q.key}"
											checked={o.isCorrect}
											onchange={() => setCorrect(q, o.key)}
											aria-label="Marcar opción {j + 1} como correcta"
											class="text-emerald-600 focus:ring-emerald-500"
										/>
										<label for="option-{o.key}" class="sr-only">Texto de la opción {j + 1}</label>
										<input
											id="option-{o.key}"
											bind:value={o.text}
											maxlength="500"
											placeholder="Opción {j + 1}"
											class="{ui.input} mt-0 {o.isCorrect
												? 'border-emerald-400 bg-emerald-50'
												: ''}"
										/>
										<button
											type="button"
											class={ui.btnIcon}
											onclick={() => removeOption(q, o.key)}
											disabled={q.options.length <= MIN_OPTIONS}
											aria-label="Quitar opción {j + 1}">✕</button
										>
									</li>
								{/each}
							</ul>
							{#if q.options.length < MAX_OPTIONS}
								<button
									type="button"
									class="mt-2 text-sm text-brand-600 hover:underline"
									onclick={() => addOption(q)}
								>
									+ Agregar opción
								</button>
							{/if}
							{#if hint}
								<p class="mt-2 text-sm text-amber-800">⚠ {hint}</p>
							{/if}
						</fieldset>
					{:else}
						<p class="mt-2 text-xs text-slate-500">
							Respuesta de texto libre, hasta {data.assessment.openMaxChars.toLocaleString('es-CO')} caracteres.
						</p>
					{/if}
				</li>
			{/each}
		</ol>

		<div class="mt-4 flex flex-wrap gap-2">
			<button type="button" class={ui.btnSecondary} onclick={() => addQuestion('opcion_unica')}>
				+ Pregunta de selección
			</button>
			<button type="button" class={ui.btnSecondary} onclick={() => addQuestion('abierta')}>
				+ Pregunta abierta
			</button>
		</div>

		<!-- Barra de guardado fija -->
		<div
			class="sticky bottom-0 -mx-4 mt-6 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur"
		>
			{#if dirty}<span class="text-sm text-amber-700">Cambios sin guardar</span>{/if}
			<button class={ui.btnPrimary} disabled={guardando || !dirty}>
				{guardando ? 'Guardando…' : 'Guardar preguntas'}
			</button>
		</div>
	</form>
{/if}
