import { error } from '@sveltejs/kit';
import { allTimeZones, toLocalDateTimeInput } from '../datetime';
import type { Assessment } from './services/assessments';
import type { AssessmentFormValues } from '../components/AssessmentForm.svelte';

/** Lee los campos del formulario de assessment como texto (para validar y re-mostrar). */
export function readAssessmentForm(form: FormData): AssessmentFormValues {
	const s = (k: string) => {
		const v = form.get(k);
		return typeof v === 'string' ? v : '';
	};
	return {
		title: s('title'),
		clientId: s('clientId'),
		description: s('description'),
		instructions: s('instructions'),
		timezone: s('timezone'),
		startsAt: s('startsAt'),
		endsAt: s('endsAt'),
		accessMode: s('accessMode'),
		openMaxChars: s('openMaxChars')
	};
}

export function assessmentToForm(a: Assessment): AssessmentFormValues {
	return {
		title: a.title,
		clientId: a.clientId ?? '',
		description: a.description,
		instructions: a.instructions,
		timezone: a.timezone,
		startsAt: toLocalDateTimeInput(a.startsAt, a.timezone),
		endsAt: toLocalDateTimeInput(a.endsAt, a.timezone),
		accessMode: a.accessMode,
		openMaxChars: a.openMaxChars
	};
}

let cachedTimezones: string[] | undefined;
export function timezoneOptions(): string[] {
	cachedTimezones ??= allTimeZones();
	return cachedTimezones;
}

/** Valida que el id de la URL tenga forma de UUID antes de consultar la base. */
export function assertUuid(id: string): void {
	if (!/^[0-9a-f-]{36}$/i.test(id)) error(404, 'No encontrado');
}
