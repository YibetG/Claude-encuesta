import { strToU8, zipSync } from 'fflate';

// Plantilla Word (.docx) para importar preguntas: un documento mínimo con instrucciones y ejemplos
// que usan las mismas marcas que reconoce questions-word.ts (subrayado y resaltado).

type Run = { text: string; bold?: boolean; underline?: boolean; highlight?: boolean };
type Para = { runs: Run[]; indent?: boolean; spaceBefore?: boolean };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function runXml(r: Run, size: number): string {
	const props = [
		'<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
		r.bold ? '<w:b/>' : '',
		r.underline ? '<w:u w:val="single"/>' : '',
		r.highlight ? '<w:highlight w:val="yellow"/>' : '',
		`<w:sz w:val="${size}"/>`
	].join('');
	return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

function paraXml(p: Para, size = 22): string {
	const ppr = [
		p.indent ? '<w:ind w:left="567"/>' : '',
		`<w:spacing w:before="${p.spaceBefore ? 240 : 0}" w:after="60"/>`
	].join('');
	return `<w:p><w:pPr>${ppr}</w:pPr>${p.runs.map((r) => runXml(r, size)).join('')}</w:p>`;
}

const text = (t: string, extra: Partial<Para> = {}): Para => ({ runs: [{ text: t }], ...extra });

export function buildWordTemplate(): Uint8Array {
	const body = [
		paraXml({ runs: [{ text: 'Plantilla de preguntas', bold: true }] }, 32),
		text(
			'Cómo usarla: escriba cada pregunta con su número (1., 2., …) y debajo sus opciones con letras (a), b), …).'
		),
		text(
			'Para indicar la respuesta correcta, subráyela o resáltela. Una pregunta sin opciones se toma como abierta.'
		),
		text(
			'Si una pregunta no es obligatoria, escriba (opcional) al final. Este texto de introducción se ignora al importar.'
		),
		paraXml({
			runs: [
				{
					text: '1. ¿Cuál es el principal objetivo de la política de seguridad de la información?',
					bold: true
				}
			],
			spaceBefore: true
		}),
		paraXml({
			runs: [
				{ text: 'a) ' },
				{ text: 'Proteger la confidencialidad, integridad y disponibilidad', underline: true }
			],
			indent: true
		}),
		paraXml({ runs: [{ text: 'b) Reducir costos de tecnología' }], indent: true }),
		paraXml({ runs: [{ text: 'c) Cumplir un requisito administrativo' }], indent: true }),
		paraXml({
			runs: [{ text: '2. ¿Qué debe hacer si recibe un correo sospechoso?', bold: true }],
			spaceBefore: true
		}),
		paraXml({ runs: [{ text: 'a) Abrir el adjunto para revisarlo' }], indent: true }),
		paraXml({
			runs: [{ text: 'b) ' }, { text: 'Reportarlo al área de seguridad', highlight: true }],
			indent: true
		}),
		paraXml({ runs: [{ text: 'c) Reenviarlo a sus compañeros' }], indent: true }),
		paraXml({
			runs: [
				{
					text: '3. Describa una situación reciente en la que aplicó este concepto. (opcional)',
					bold: true
				}
			],
			spaceBefore: true
		})
	];
	const paragraphs = body.map((p) => (typeof p === 'string' ? p : paraXml(p))).join('');

	const document =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
		`<w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
		'<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';

	return zipSync({
		'[Content_Types].xml': strToU8(
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
				'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
				'<Default Extension="xml" ContentType="application/xml"/>' +
				'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
				'</Types>'
		),
		'_rels/.rels': strToU8(
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
				'</Relationships>'
		),
		'word/document.xml': strToU8(document)
	});
}
