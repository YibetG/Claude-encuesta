import { unzipSync } from 'fflate';
import { ImportFileError } from './table';

// Lectura mínima de documentos Word (.docx) para importar preguntas.
// Un .docx es un ZIP con XML. Solo se leen word/document.xml (párrafos, texto, subrayado,
// resaltado) y word/numbering.xml (para saber si una lista automática es 1., a) o viñetas).
// El XML se recorre con un tokenizador propio: no se resuelven entidades externas ni DTD.

/** Un tramo de texto con el mismo formato. */
export type DocxRun = { text: string; marked: boolean };

/** Un párrafo del documento. `list` existe si Word lo numera automáticamente. */
export type DocxParagraph = {
	runs: DocxRun[];
	list?: { level: number; format: string };
};

const MAX_XML_BYTES = 20 * 1024 * 1024; // descomprimido: protege contra "bombas ZIP"
const MAX_PARAGRAPHS = 5000;

/** Abre el .docx y devuelve sus párrafos. Lanza ImportFileError si el archivo no es válido. */
export function readDocx(data: Uint8Array): DocxParagraph[] {
	// Un .docx empieza con la firma ZIP "PK\x03\x04". Un .doc antiguo (binario) no.
	if (data[0] !== 0x50 || data[1] !== 0x4b) {
		throw new ImportFileError(
			'El archivo no es un Word .docx. Si es un .doc antiguo, ábralo en Word y guárdelo como .docx.'
		);
	}

	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(data, {
			filter: (f) =>
				(f.name === 'word/document.xml' || f.name === 'word/numbering.xml') &&
				f.originalSize <= MAX_XML_BYTES
		});
	} catch {
		throw new ImportFileError('No se pudo abrir el archivo Word. Verifique que no esté dañado.');
	}

	const doc = files['word/document.xml'];
	if (!doc || doc.length > MAX_XML_BYTES) {
		throw new ImportFileError('El archivo Word no tiene contenido legible o es demasiado grande.');
	}
	const decoder = new TextDecoder('utf-8');
	const numbering = files['word/numbering.xml']
		? readNumbering(decoder.decode(files['word/numbering.xml']))
		: new Map<string, string[]>();
	return readParagraphs(decoder.decode(doc), numbering);
}

// ---- Tokenizador XML ---------------------------------------------------------

type Tag = { name: string; attrs: Record<string, string>; close: boolean; selfClose: boolean };
type Token = { tag: Tag } | { text: string };

const TAG_RE = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
		const k = e.toLowerCase();
		if (k === 'amp') return '&';
		if (k === 'lt') return '<';
		if (k === 'gt') return '>';
		if (k === 'quot') return '"';
		if (k === 'apos') return "'";
		const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
	});
}

function* tokens(xml: string): Generator<Token> {
	let i = 0;
	while (i < xml.length) {
		const lt = xml.indexOf('<', i);
		if (lt === -1) {
			yield { text: decodeEntities(xml.slice(i)) };
			return;
		}
		if (lt > i) yield { text: decodeEntities(xml.slice(i, lt)) };

		// Declaraciones, comentarios, CDATA e instrucciones: se saltan.
		if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
			const end = xml.startsWith('<!--', lt)
				? xml.indexOf('-->', lt) + 3
				: xml.startsWith('<![CDATA[', lt)
					? xml.indexOf(']]>', lt) + 3
					: xml.indexOf('>', lt) + 1;
			if (end <= lt) return;
			i = end;
			continue;
		}

		TAG_RE.lastIndex = lt;
		const m = TAG_RE.exec(xml);
		if (!m) {
			i = lt + 1; // "<" suelto: se ignora
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const a of m[3].matchAll(ATTR_RE)) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
		yield { tag: { name: m[2], attrs, close: m[1] === '/', selfClose: m[4] === '/' } };
		i = TAG_RE.lastIndex;
	}
}

// ---- numbering.xml: numId → formato de cada nivel ----------------------------

function readNumbering(xml: string): Map<string, string[]> {
	const abstractFormats = new Map<string, string[]>();
	const numToAbstract = new Map<string, string>();
	let abstractId: string | null = null;
	let level = -1;
	let numId: string | null = null;

	for (const t of tokens(xml)) {
		if (!('tag' in t)) continue;
		const { name, attrs, close } = t.tag;
		if (name === 'w:abstractNum') {
			abstractId = close ? null : (attrs['w:abstractNumId'] ?? null);
			if (abstractId) abstractFormats.set(abstractId, []);
		} else if (name === 'w:lvl' && !close) {
			level = Number(attrs['w:ilvl'] ?? 0);
		} else if (name === 'w:numFmt' && abstractId && level >= 0 && level < 9) {
			abstractFormats.get(abstractId)![level] = attrs['w:val'] ?? 'decimal';
		} else if (name === 'w:num') {
			numId = close ? null : (attrs['w:numId'] ?? null);
		} else if (name === 'w:abstractNumId' && numId) {
			numToAbstract.set(numId, attrs['w:val'] ?? '');
		}
	}

	const out = new Map<string, string[]>();
	for (const [id, abs] of numToAbstract) out.set(id, abstractFormats.get(abs) ?? []);
	return out;
}

// ---- document.xml: párrafos y tramos ------------------------------------------

/** ¿El formato del tramo marca la respuesta? Subrayado o resaltado (o sombreado de color). */
function isMarkTag(tag: Tag): boolean {
	const val = (tag.attrs['w:val'] ?? '').toLowerCase();
	if (tag.name === 'w:u') return val !== 'none' && val !== '0' && val !== 'false';
	if (tag.name === 'w:highlight') return val !== 'none' && val !== '';
	if (tag.name === 'w:shd') {
		const fill = (tag.attrs['w:fill'] ?? '').toLowerCase();
		return fill !== '' && fill !== 'auto' && fill !== 'ffffff';
	}
	return false;
}

function readParagraphs(xml: string, numbering: Map<string, string[]>): DocxParagraph[] {
	const paragraphs: DocxParagraph[] = [];
	let p: DocxParagraph | null = null;
	let inRun = false;
	let inRunProps = false;
	let inParaProps = false;
	let inText = false;
	let marked = false;
	let numId: string | null = null;
	let ilvl = 0;
	// Las tablas, cuadros de texto y notas pueden anidar párrafos: se aplanan en orden.
	const push = (text: string) => {
		if (!p || !text) return;
		const last = p.runs.at(-1);
		if (last && last.marked === marked) last.text += text;
		else p.runs.push({ text, marked });
	};

	for (const t of tokens(xml)) {
		if (!('tag' in t)) {
			if (inText) push(t.text);
			continue;
		}
		const { name, attrs, close, selfClose } = t.tag;
		switch (name) {
			case 'w:p':
				if (!close) {
					p = { runs: [] };
					numId = null;
					ilvl = 0;
					if (selfClose) {
						paragraphs.push(p);
						p = null;
					}
				} else if (p) {
					const formats = numId ? numbering.get(numId) : undefined;
					if (numId && numId !== '0') {
						p.list = { level: ilvl, format: formats?.[ilvl] ?? 'decimal' };
					}
					paragraphs.push(p);
					p = null;
					if (paragraphs.length > MAX_PARAGRAPHS) {
						throw new ImportFileError(
							`El documento es demasiado largo (más de ${MAX_PARAGRAPHS} párrafos).`
						);
					}
				}
				break;
			case 'w:pPr':
				inParaProps = !close && !selfClose;
				break;
			case 'w:numId':
				if (inParaProps && !inRunProps) numId = attrs['w:val'] ?? null;
				break;
			case 'w:ilvl':
				if (inParaProps && !inRunProps) ilvl = Number(attrs['w:val'] ?? 0) || 0;
				break;
			case 'w:r':
				inRun = !close && !selfClose;
				marked = false;
				break;
			case 'w:rPr':
				inRunProps = !close && !selfClose;
				break;
			case 'w:u':
			case 'w:highlight':
			case 'w:shd':
				if (inRun && inRunProps && isMarkTag(t.tag)) marked = true;
				break;
			case 'w:t':
				inText = !close && !selfClose && inRun;
				break;
			case 'w:tab':
				if (inRun && !inRunProps) push('\t');
				break;
			case 'w:br':
			case 'w:cr':
				if (inRun) push('\n');
				break;
		}
	}
	return paragraphs;
}
