import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocx } from './docx';
import { parseWordQuestions } from './questions-word';
import { ImportFileError } from './table';
import { buildWordTemplate } from './word-template';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Arma un .docx mínimo con el cuerpo dado (y numbering.xml opcional). */
function docx(body: string, numbering?: string): Uint8Array {
	const files: Record<string, Uint8Array> = {
		'word/document.xml': strToU8(
			`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`
		)
	};
	if (numbering)
		files['word/numbering.xml'] = strToU8(`<w:numbering ${W}>${numbering}</w:numbering>`);
	return zipSync(files);
}

const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
const r = (text: string, props = '') =>
	`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const U = '<w:u w:val="single"/>';
const HL = '<w:highlight w:val="yellow"/>';
const list = (numId: number, ilvl: number, ...runs: string[]) =>
	`<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runs.join('')}</w:p>`;

const parse = (data: Uint8Array) => parseWordQuestions(readDocx(data));

describe('importar preguntas desde Word', () => {
	it('lee la plantilla: subrayado, resaltado, abierta y opcional', () => {
		const result = parse(buildWordTemplate());
		expect(result).toEqual({
			ok: true,
			warnings: [],
			questions: [
				{
					type: 'opcion_unica',
					prompt: '¿Cuál es el principal objetivo de la política de seguridad de la información?',
					required: true,
					options: [
						{ text: 'Proteger la confidencialidad, integridad y disponibilidad', isCorrect: true },
						{ text: 'Reducir costos de tecnología', isCorrect: false },
						{ text: 'Cumplir un requisito administrativo', isCorrect: false }
					]
				},
				{
					type: 'opcion_unica',
					prompt: '¿Qué debe hacer si recibe un correo sospechoso?',
					required: true,
					options: [
						{ text: 'Abrir el adjunto para revisarlo', isCorrect: false },
						{ text: 'Reportarlo al área de seguridad', isCorrect: true },
						{ text: 'Reenviarlo a sus compañeros', isCorrect: false }
					]
				},
				{
					type: 'abierta',
					prompt: 'Describa una situación reciente en la que aplicó este concepto.',
					required: false,
					options: []
				}
			]
		});
	});

	it('entiende las listas automáticas de Word (1., a), viñetas)', () => {
		const numbering =
			'<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>' +
			'<w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>' +
			'<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
			'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
			'<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
		const body =
			p(r('Evaluación de ciberseguridad')) +
			list(1, 0, r('¿Qué es phishing?')) +
			list(1, 1, r('Un tipo de pesca')) +
			list(1, 1, r('Un engaño para robar datos', HL)) +
			list(1, 0, r('¿Dónde se reporta?')) +
			list(2, 0, r('En la mesa de ayuda', U)) +
			list(2, 0, r('En ningún lado'));
		const result = parse(docx(body, numbering));
		if (!result.ok) throw new Error(result.errors.join());
		expect(result.warnings).toEqual([]);
		expect(result.questions.map((q) => q.prompt)).toEqual([
			'¿Qué es phishing?',
			'¿Dónde se reporta?'
		]);
		expect(result.questions[0].options.map((o) => o.isCorrect)).toEqual([false, true]);
		expect(result.questions[1].options.map((o) => o.isCorrect)).toEqual([true, false]);
	});

	it('sin números: el texto suelto con opciones debajo es una pregunta', () => {
		const body =
			p(r('¿Usa contraseñas largas?')) +
			p(r('a) Sí', U)) +
			p(r('b) No')) +
			p(r('Comentarios finales'));
		const result = parse(docx(body));
		if (!result.ok) throw new Error(result.errors.join());
		expect(result.questions.map((q) => [q.type, q.prompt])).toEqual([
			['opcion_unica', '¿Usa contraseñas largas?'],
			['abierta', 'Comentarios finales']
		]);
	});

	it('avisa (sin bloquear) lo que hay que revisar', () => {
		const body =
			p(r('1. Sin marca')) +
			p(r('a) Uno')) +
			p(r('b) Dos')) +
			p(r('2. Dos marcadas')) +
			p(r('a) Uno', U)) +
			p(r('b) Dos', HL)) +
			p(r('3. Una sola opción')) +
			p(r('a) Única', U)) +
			p(r('Nota al pie suelta'));
		const result = parse(docx(body));
		if (!result.ok) throw new Error(result.errors.join());
		expect(result.questions[0].options.every((o) => !o.isCorrect)).toBe(true);
		expect(result.questions[1].options.map((o) => o.isCorrect)).toEqual([true, false]);
		expect(result.warnings).toEqual([
			'Se ignoró el texto "Nota al pie suelta" (después de la pregunta 3).',
			'Pregunta 1: no tiene la respuesta subrayada ni resaltada. Márquela en el editor.',
			'Pregunta 2: tiene varias opciones marcadas; se tomó la primera. Revísela.',
			'Pregunta 3: tiene una sola opción (mínimo 2).'
		]);
	});

	it('enunciado en varias líneas, "(correcta)" y marcas que no son opciones', () => {
		const body =
			p(r('1.')) +
			p(r('Lea el caso:')) +
			p(r('E-mail recibido a las 3 p. m. por 1.5 horas')) +
			p(r('a. Lo ignoro')) +
			p(r('b. Lo reporto (correcta)')) +
			// Solo una parte pequeña subrayada: no cuenta como marca.
			p(r('c. Lo reenvío a '), r('todos', U), r(' los compañeros del área'));
		const result = parse(docx(body));
		if (!result.ok) throw new Error(result.errors.join());
		expect(result.questions[0].prompt).toBe(
			'Lea el caso:\nE-mail recibido a las 3 p. m. por 1.5 horas'
		);
		expect(result.questions[0].options).toEqual([
			{ text: 'Lo ignoro', isCorrect: false },
			{ text: 'Lo reporto', isCorrect: true },
			{ text: 'Lo reenvío a todos los compañeros del área', isCorrect: false }
		]);
	});

	it('decodifica entidades y no interpreta el XML como instrucciones', () => {
		const body = p(r('1. ¿&lt;b&gt; &amp; &#233;?')) + p(r('a) S&#xED;', U)) + p(r('b) No'));
		const result = parse(docx(body));
		if (!result.ok) throw new Error(result.errors.join());
		expect(result.questions[0].prompt).toBe('¿<b> & é?');
		expect(result.questions[0].options[0].text).toBe('Sí');
	});

	it('rechaza archivos que no son .docx o no tienen preguntas', () => {
		expect(() => readDocx(strToU8('{\\rtf1 hola}'))).toThrow(ImportFileError);
		expect(() => readDocx(zipSync({ 'otro.txt': strToU8('x') }))).toThrow(ImportFileError);
		const empty = parse(docx(p(r('Solo un título'))));
		// Sin números, el texto suelto se toma como pregunta abierta: el admin la revisa.
		expect(empty.ok).toBe(true);
		const none = parse(docx(''));
		expect(none.ok).toBe(false);
	});
});
