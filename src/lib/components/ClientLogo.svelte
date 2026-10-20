<script lang="ts">
	// Logo del cliente en las pantallas del participante. Sin logo, se muestra el ícono de la plataforma.
	let { src, size = 'md' }: { src: string | null; size?: 'sm' | 'md' } = $props();
	const box = $derived(size === 'sm' ? 'h-9 max-w-28 px-1.5' : 'h-14 max-w-44 px-2.5');
</script>

{#if src}
	<span class="inline-flex items-center rounded-xl bg-white py-1.5 {box}">
		<!-- Altura completa del recuadro: los logos pequeños también se ven a buen tamaño. -->
		<img {src} alt="Logo" class="h-full w-auto max-w-full object-contain" />
	</span>
{:else}
	<span
		class="inline-flex items-center justify-center rounded-lg bg-brand-600 text-white {size === 'sm'
			? 'h-8 w-8'
			: 'h-10 w-10'}"
		aria-hidden="true"
	>
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
			><path d="M9 11l3 3 8-8"></path><path
				d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"
			></path></svg
		>
	</span>
{/if}
