// Anonimización de las respuestas antes de enviarlas a la IA.
// - Nunca se envían nombre, email, área ni cargo de quien respondió: solo el texto.
// - Además se reemplazan dentro del texto los emails, teléfonos y los nombres de
//   los participantes del assessment (por si alguien se nombra a sí mismo o a un colega).
// Es una medida de minimización: nombres de terceros que no están en la lista
// pueden seguir apareciendo en el texto libre.

// Los cuantificadores van acotados: con `+` sin límite, un texto largo sin "@" hace que la
// búsqueda sea cuadrática (más de un minuto para 100.000 caracteres).
const EMAIL_RE = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}/gi;
// 7 o más dígitos, con espacios, puntos, guiones o paréntesis opcionales (ej. +57 300 123 4567).
const PHONE_RE = /\+?\d[\d\s().-]{5,20}\d/g;

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Palabras comunes que nunca se tratan como parte de un nombre. En modo abierto el nombre
// lo escribe el participante: sin esta lista, un "nombre" como "que para con" borraría
// esas palabras de todas las respuestas y arruinaría el análisis.
const STOPWORDS = new Set(
	(
		'que para con por los las del una uno unos unas como pero mas muy sin sobre entre ' +
		'este esta esto ese esa eso son ser fue hay todo toda todos todas cuando donde ' +
		'porque tambien desde hasta nos les sus mis tus equipo area empresa trabajo'
	).split(' ')
);

/** Palabras de un nombre que vale la pena buscar (se omiten las cortas y las comunes). */
function nameTokens(fullName: string): string[] {
	const words = fullName
		.split(/\s+/)
		.filter((w) => w.length >= 3 && !STOPWORDS.has(strip(w).toLowerCase()));
	const full = fullName.trim();
	// El nombre completo solo se usa si no es, él mismo, una sola palabra común.
	const useFull = full && !STOPWORDS.has(strip(full).toLowerCase());
	return [...(useFull ? [full] : []), ...words];
}

export type Anonymizer = (text: string) => string;

/**
 * Crea una función que anonimiza textos usando la lista de nombres conocidos.
 * La búsqueda ignora mayúsculas y tildes ("José" también reemplaza "jose").
 */
export function createAnonymizer(names: string[]): Anonymizer {
	const tokens = [...new Set(names.flatMap(nameTokens).map((t) => strip(t).toLowerCase()))]
		// Primero los más largos, para reemplazar "Ana María Pérez" antes que "Ana".
		.sort((a, b) => b.length - a.length);

	const nameRe = tokens.length
		? new RegExp(
				`(?<![\\p{L}\\p{N}])(?:${tokens.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`,
				'giu'
			)
		: null;

	return (text) => {
		let out = text.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[teléfono]');
		if (nameRe) {
			// Se busca sobre una versión sin tildes y se reemplaza en el texto original.
			// La versión sin tildes se arma unidad por unidad (UTF-16), así cada posición
			// coincide con la del original (un emoji ocupa dos unidades en ambos).
			const plain = out
				.split('')
				.map((unit) => strip(unit))
				.join('');
			let result = '';
			let last = 0;
			for (const m of plain.matchAll(nameRe)) {
				result += out.slice(last, m.index) + '[persona]';
				last = m.index! + m[0].length;
			}
			out = result + out.slice(last);
		}
		return out;
	};
}

/**
 * Divide las respuestas en bloques de tamaño acotado para no exceder lo razonable
 * por llamada. Una respuesta nunca se parte entre bloques.
 */
export function chunkResponses(responses: string[], maxChars: number): string[][] {
	const chunks: string[][] = [];
	let current: string[] = [];
	let size = 0;
	for (const r of responses) {
		if (current.length && size + r.length > maxChars) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(r);
		size += r.length;
	}
	if (current.length) chunks.push(current);
	return chunks;
}
