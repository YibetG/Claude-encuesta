<script lang="ts" module>
	export type BarItem = {
		key: string;
		label: string;
		/** Proporción 0–1 que define el largo de la barra. */
		rate: number;
		/** Texto al final de la barra (ej. "2 · 67%"). */
		value: string;
		/** Texto del tooltip al pasar el mouse o enfocar. */
		tooltip: string;
		/** Barra destacada (color de acento); las demás van en gris. */
		highlight?: boolean;
		/** Etiqueta junto al texto (ej. "✓ Esperada"), para que el destaque no dependa solo del color. */
		badge?: string;
		href?: string;
	};
</script>

<script lang="ts">
	// Gráfico de barras horizontales de una sola serie, accesible:
	// - barras ≤ 20 px con extremo redondeado de 4 px, sin borde;
	// - valor visible al final de cada barra (texto en color de texto, no del dato);
	// - tooltip al pasar el mouse (la misma información ya está visible en texto);
	// - el destaque se acompaña de una etiqueta, nunca solo color.
	let { items, label }: { items: BarItem[]; label: string } = $props();
</script>

<ul class="space-y-2" aria-label={label}>
	{#each items as item (item.key)}
		<li
			class="group relative grid grid-cols-1 gap-1 rounded-md px-1 py-1 hover:bg-slate-50 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-center sm:gap-3"
		>
			<span class="text-sm text-slate-800">
				{#if item.href}
					<!-- Ancla dentro de la misma página (#pregunta-n). -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={item.href} class="hover:underline">{item.label}</a>
				{:else}
					{item.label}
				{/if}
				{#if item.badge}
					<span
						class="ml-1 inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-indigo-800 ring-1 ring-indigo-200 ring-inset"
						>{item.badge}</span
					>
				{/if}
			</span>
			<span class="flex items-center gap-2">
				<span class="relative h-5 flex-1" aria-hidden="true">
					<span
						class="absolute inset-y-0 left-0 rounded-r {item.highlight
							? 'bg-indigo-600'
							: 'bg-slate-400'}"
						style="width: {Math.max(item.rate * 100, item.rate > 0 ? 1 : 0)}%"
					></span>
				</span>
				<span class="w-24 shrink-0 text-right text-sm text-slate-700 tabular-nums"
					>{item.value}</span
				>
			</span>
			<!-- Tooltip al pasar el mouse. Repite lo que ya está visible, por eso se oculta a lectores de pantalla. -->
			<span
				aria-hidden="true"
				class="pointer-events-none absolute -top-8 right-0 z-10 hidden rounded bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow group-hover:block"
			>
				{item.tooltip}
			</span>
		</li>
	{/each}
</ul>
