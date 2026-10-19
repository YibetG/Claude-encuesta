<script lang="ts">
	import { STATUS_LABELS, type AssessmentStatus } from '#lib/constants.ts';

	let { status }: { status: AssessmentStatus } = $props();

	const styles: Record<AssessmentStatus, string> = {
		borrador: 'bg-slate-100 text-slate-700 ring-slate-300',
		publicado: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
		archivado: 'bg-amber-50 text-amber-800 ring-amber-300'
	};
</script>

<span
	class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {styles[
		status
	]}"
>
	{STATUS_LABELS[status]}
</span>
