<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
	<h1 class="text-3xl font-semibold tracking-tight">Plataforma de Assessments</h1>
	<p class="mt-3 text-slate-600">
		Si recibió una invitación, abra el enlace que le enviaron para responder el assessment.
	</p>
	<p class="mt-8">
		<a
			href={resolve('/admin')}
			class="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
		>
			Ingreso de administradores
		</a>
	</p>
</main>
