import { error } from '@sveltejs/kit';
import { db } from './db/index';
import { getAssessment } from './services/assessments';
import { assertUuid } from './forms';

/** Carga el assessment de la URL o responde 404. */
export function requireAssessment(id: string) {
	assertUuid(id);
	const a = getAssessment(db, id);
	if (!a) error(404, 'Assessment no encontrado');
	return a;
}
