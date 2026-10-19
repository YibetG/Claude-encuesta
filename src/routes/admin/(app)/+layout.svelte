<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: resolve('/admin/(app)'), label: 'Assessments', exact: true },
		{ href: resolve('/admin/(app)/auditoria'), label: 'Auditoría', exact: false }
	];

	function isActive(href: string, exact: boolean) {
		return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
	}
</script>

<header class="border-b border-slate-200 bg-white">
	<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
		<a href={resolve('/admin/(app)')} class="font-semibold text-slate-900">Assessments</a>

		<nav aria-label="Principal" class="flex gap-1">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={isActive(link.href, link.exact) ? 'page' : undefined}
					class="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 aria-[current=page]:bg-indigo-50 aria-[current=page]:font-medium aria-[current=page]:text-indigo-700"
				>
					{link.label}
				</a>
			{/each}
		</nav>

		<div class="ml-auto flex items-center gap-3 text-sm">
			<span class="text-slate-600">{data.admin.name}</span>
			<form method="POST" action={resolve('/admin/logout')}>
				<button
					type="submit"
					class="rounded-md px-3 py-1.5 text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 hover:text-slate-900"
				>
					Cerrar sesión
				</button>
			</form>
		</div>
	</div>
</header>

<main class="mx-auto max-w-6xl px-4 py-8">
	{@render children()}
</main>
