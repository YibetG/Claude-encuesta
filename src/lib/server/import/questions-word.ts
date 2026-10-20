import { MAX_OPTIONS, MAX_QUESTIONS } from '../../schemas/question';
import type { DocxParagraph } from './docx';

// Convierte los párrafos de un Word en preguntas. Formato esperado (ver plantilla Word):
//
//   1. ¿Enunciado de la pregunta?          ← número (escrito o lista automática de Word)
//      a) Opción                            ← letra, viñeta o sublista
//      b) Opción correcta                   ← subrayada o resaltada
//   2. Pregunta abierta (opcional)          ← sin opciones = abierta; "(opcional)" = no obligatoria
//
// El resultado NO se guarda: se carga en el editor para revisarlo. Por eso, en lugar de rechazar
// todo ante un problema, se devuelven avisos por pregunta.

export type DraftQuestion = {
	type: 'opcion_unica' | 'abierta';
	prompt: string;
	required: boolean;
	options: { text: string; isCorrect: boolean }[];
};

export type WordImport =
	{ ok: true; questions: DraftQuestion[]; warnings: string[] } | { ok: false; errors: string[] };

// "1." / "1)" / "Pregunta 1:" (pero no "1.5 millones").
const QUESTION_MARK = /^(?:pregunta\s*)?\d{1,3}\s*[.)\-–:](?!\d)\s*/i;
// "a)" / "B." / "(c)" seguidos de espacio (así "E-mail" no cuenta), o una viñeta.
const OPTION_MARK = /^(?:\(?[a-hA-H]\s*[.)-](?=\s)|[•·\-–—*▪◦●■□○➢►]|o(?=\t))\s*/;
const OPTIONAL_TAG = /\s*\((?:opcional|no obligatoria)\)\s*$/i;
const REQUIRED_TAG = /\s*\((?:obligatoria|requerida)\)\s*$/i;
const CORRECT_TAG = /\s*\((?:correcta|respuesta correcta|x)\)\s*$/i;
const QUESTION_FORMATS = new Set([
	'decimal',
	'decimalZero',
	'ordinal',
	'cardinalText',
	'ordinalText'
]);

type Kind = 'question' | 'option' | 'plain';
type Line = { kind: Kind; text: string; marked: boolean; explicitQuestion: boolean };

const nonSpace = (s: string) => s.replace(/\s+/g, '').length;
const clean = (s: string) =>
	s
		.replace(/[^\S\n]+/g, ' ') // espacios, tabulaciones y espacios duros, sin tocar saltos
		.replace(/ *\n */g, '\n')
		.trim();

function classify(p: DocxParagraph): Line | null {
	const raw = p.runs.map((r) => r.text).join('');
	// Las marcas se buscan antes de limpiar: la viñeta "o" de Word va seguida de tabulación.
	const lead = raw.replace(/^\s+/, '');
	const text = clean(lead);
	if (!text) return null;

	// Marcada si al menos la mitad del texto visible está subrayado o resaltado.
	const total = nonSpace(raw);
	const markedChars = nonSpace(
		p.runs
			.filter((r) => r.marked)
			.map((r) => r.text)
			.join('')
	);
	const marked = markedChars > 0 && markedChars * 2 >= total;

	if (QUESTION_MARK.test(lead)) {
		const rest = clean(lead.replace(QUESTION_MARK, ''));
		return { kind: 'question', text: rest, marked, explicitQuestion: true };
	}
	if (OPTION_MARK.test(lead)) {
		const rest = clean(lead.replace(OPTION_MARK, ''));
		return { kind: 'option', text: rest, marked, explicitQuestion: false };
	}
	if (p.list) {
		const isQuestion = p.list.level === 0 && QUESTION_FORMATS.has(p.list.format);
		return { kind: isQuestion ? 'question' : 'option', text, marked, explicitQuestion: isQuestion };
	}
	return { kind: 'plain', text, marked, explicitQuestion: false };
}

const snippet = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

export function parseWordQuestions(paragraphs: DocxParagraph[]): WordImport {
	const lines = paragraphs.map(classify).filter((l): l is Line => l !== null);
	// Si el documento numera sus preguntas, el texto suelto no inicia preguntas (son títulos o notas).
	const numbered = lines.some((l) => l.explicitQuestion);

	const questions: DraftQuestion[] = [];
	const marks: boolean[][] = [];
	const warnings: string[] = [];
	let ignoredBefore = 0;
	let current: DraftQuestion | null = null;

	const start = (text: string) => {
		current = { type: 'abierta', prompt: text, required: true, options: [] };
		questions.push(current);
		marks.push([]);
	};

	for (const line of lines) {
		const q = current as DraftQuestion | null;
		if (line.kind === 'question') {
			start(line.text);
		} else if (line.kind === 'option') {
			if (!q) {
				ignoredBefore++;
				continue;
			}
			const correctByText = CORRECT_TAG.test(line.text);
			q.type = 'opcion_unica';
			q.options.push({ text: line.text.replace(CORRECT_TAG, ''), isCorrect: false });
			marks[marks.length - 1].push(line.marked || correctByText);
		} else if (q && q.options.length === 0) {
			// Texto suelto antes de las opciones: continúa el enunciado.
			q.prompt += `\n${line.text}`;
		} else if (!numbered) {
			start(line.text);
		} else if (!q) {
			continue; // Título o introducción antes de la primera pregunta.
		} else {
			warnings.push(
				`Se ignoró el texto "${snippet(line.text)}" (después de la pregunta ${questions.length}).`
			);
		}
	}

	if (questions.length === 0) {
		return {
			ok: false,
			errors: [
				'No se encontraron preguntas en el documento. Numere cada pregunta (1., 2., …) y ponga las opciones debajo con letras (a), b), …). Descargue la plantilla Word para ver un ejemplo.'
			]
		};
	}
	if (questions.length > MAX_QUESTIONS) {
		return {
			ok: false,
			errors: [`El documento tiene ${questions.length} preguntas; el máximo es ${MAX_QUESTIONS}.`]
		};
	}

	questions.forEach((q, i) => {
		const n = i + 1;
		q.prompt = q.prompt.trim();
		if (OPTIONAL_TAG.test(q.prompt)) {
			q.required = false;
			q.prompt = q.prompt.replace(OPTIONAL_TAG, '');
		} else {
			q.prompt = q.prompt.replace(REQUIRED_TAG, '');
		}
		if (q.prompt.length > 2000)
			warnings.push(`Pregunta ${n}: el enunciado supera 2.000 caracteres.`);
		if (q.type === 'abierta') return;

		const marked = marks[i];
		const first = marked.indexOf(true);
		if (first >= 0) q.options[first].isCorrect = true;
		if (first === -1) {
			warnings.push(
				`Pregunta ${n}: no tiene la respuesta subrayada ni resaltada. Márquela en el editor.`
			);
		} else if (marked.filter(Boolean).length > 1) {
			warnings.push(`Pregunta ${n}: tiene varias opciones marcadas; se tomó la primera. Revísela.`);
		}
		if (q.options.length === 1) warnings.push(`Pregunta ${n}: tiene una sola opción (mínimo 2).`);
		if (q.options.length > MAX_OPTIONS) {
			warnings.push(`Pregunta ${n}: tiene ${q.options.length} opciones (máximo ${MAX_OPTIONS}).`);
		}
		if (q.options.some((o) => o.text.length > 500)) {
			warnings.push(`Pregunta ${n}: una opción supera 500 caracteres.`);
		}
	});

	if (ignoredBefore) {
		warnings.unshift(
			`Se ignoraron ${ignoredBefore} ${ignoredBefore === 1 ? 'opción' : 'opciones'} que aparecen antes de la primera pregunta.`
		);
	}
	return { ok: true, questions, warnings };
}
