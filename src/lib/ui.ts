// Clases de Tailwind reutilizadas en formularios y botones, para mantener un estilo uniforme.

export const ui = {
	label: 'block text-sm font-medium text-slate-700',
	hint: 'mt-1 text-xs text-slate-500',
	input:
		'mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm aria-[invalid=true]:border-red-400',
	fieldError: 'mt-1 text-sm text-red-600',
	card: 'rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200',
	btnPrimary:
		'inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60',
	btnSecondary:
		'inline-flex items-center justify-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60',
	btnDanger:
		'inline-flex items-center justify-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
	btnIcon:
		'inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40',
	alertError: 'rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200',
	alertSuccess:
		'rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200',
	alertWarning: 'rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200'
} as const;
