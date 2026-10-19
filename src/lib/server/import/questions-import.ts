import ExcelJS from 'exceljs';
import {
	MAX_OPTIONS,
	questionListSchema,
	questionIssues,
	type QuestionInput
} from '../../schemas/question';
import { cellGetter, normalizeHeader, type Table } from './table';

// Formato de la plantilla de preguntas:
//   tipo | enunciado | obligatoria | opcion_1 … opcion_6 | correcta
// - tipo: "seleccion" o "abierta" (también acepta "opcion_unica", "multiple", "texto")
// - obligatoria: si / no (por defecto si)
// - correcta: número de la opción correcta (1–6) o letra (A–F)

export const TEMPLATE_HEADERS = [
	'tipo',
	'enunciado',
	'obligatoria',
	...Array.from({ length: MAX_OPTIONS }, (_, i) => `opcion_${i + 1}`),
	'correcta'
];

const TYPE_ALIASES: Record<string, QuestionInput['type']> = {
	seleccion: 'opcion_unica',
	seleccion_multiple: 'opcion_unica',
	seleccion_unica: 'opcion_unica',
	multiple: 'opcion_unica',
	opcion_unica: 'opcion_unica',
	opcion: 'opcion_unica',
	abierta: 'abierta',
	texto: 'abierta',
	respuesta_abierta: 'abierta'
};

const YES = new Set(['si', 's', 'true', '1', 'x', 'yes']);
const NO = new Set(['no', 'n', 'false', '0']);

export type ImportResult =
	{ ok: true; questions: QuestionInput[] } | { ok: false; errors: string[] };

/** Convierte las filas del archivo en preguntas validadas. Si hay algún error no se importa nada. */
export function parseQuestionRows(table: Table): ImportResult {
	const errors: string[] = [];
	if (
		!table.headers.includes('tipo') ||
		!table.headers.some((h) => h === 'enunciado' || h === 'pregunta')
	) {
		return {
			ok: false,
			errors: ['El archivo debe tener las columnas "tipo" y "enunciado". Descargue la plantilla.']
		};
	}

	const get = cellGetter(table.headers);
	// Fila 1 = encabezados, así que la primera fila de datos es la 2 (como la ve el usuario en Excel).
	const ROW_OFFSET = 2;
	const candidates: unknown[] = table.rows.map((row, i) => {
		const rowNum = i + ROW_OFFSET;
		const typeRaw = normalizeHeader(get(row, 'tipo'));
		const type = TYPE_ALIASES[typeRaw];
		if (!type) {
			errors.push(
				`Fila ${rowNum}: tipo "${get(row, 'tipo')}" no reconocido (use "seleccion" o "abierta").`
			);
			return null;
		}

		const reqRaw = normalizeHeader(get(row, 'obligatoria', 'requerida'));
		let required = true;
		if (YES.has(reqRaw) || reqRaw === '') required = true;
		else if (NO.has(reqRaw)) required = false;
		else errors.push(`Fila ${rowNum}: "obligatoria" debe ser "si" o "no".`);

		const prompt = get(row, 'enunciado', 'pregunta');
		if (type === 'abierta') return { type, prompt, required };

		const texts = Array.from({ length: MAX_OPTIONS }, (_, k) => get(row, `opcion_${k + 1}`));
		// Las opciones vacías al final se ignoran; las intermedias son error.
		const lastFilled = texts.findLastIndex((t) => t !== '');
		const used = texts.slice(0, lastFilled + 1);
		if (used.some((t) => t === '')) {
			errors.push(`Fila ${rowNum}: hay opciones vacías entre opciones con texto.`);
		}

		const correctRaw = get(row, 'correcta', 'respuesta_correcta').toUpperCase();
		let correct = Number(correctRaw);
		if (/^[A-F]$/.test(correctRaw)) correct = correctRaw.charCodeAt(0) - 64;
		if (!Number.isInteger(correct) || correct < 1 || correct > used.length) {
			errors.push(
				`Fila ${rowNum}: "correcta" debe ser el número de una opción con texto (1 a ${Math.max(used.length, 1)}).`
			);
		}

		return {
			type,
			prompt,
			required,
			options: used.map((text, k) => ({ text, isCorrect: k + 1 === correct }))
		};
	});

	if (errors.length) return { ok: false, errors };

	const parsed = questionListSchema.safeParse(candidates);
	if (!parsed.success)
		return { ok: false, errors: questionIssues(parsed.error, 'Fila', ROW_OFFSET) };
	return { ok: true, questions: parsed.data };
}

/** Plantilla Excel descargable, con ejemplos y una hoja de instrucciones. */
export async function buildQuestionTemplate(): Promise<ArrayBuffer> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Plataforma de Assessments';

	const ws = wb.addWorksheet('Preguntas');
	ws.columns = TEMPLATE_HEADERS.map((h) => ({
		header: h,
		key: h,
		width: h === 'enunciado' ? 60 : h.startsWith('opcion') ? 28 : 14
	}));
	ws.getRow(1).font = { bold: true };
	ws.views = [{ state: 'frozen', ySplit: 1 }];
	ws.addRow([
		'seleccion',
		'¿Cuál es el principal objetivo de la política de seguridad de la información?',
		'si',
		'Proteger la confidencialidad, integridad y disponibilidad',
		'Reducir costos de tecnología',
		'Cumplir un requisito administrativo',
		'',
		'',
		'',
		1
	]);
	ws.addRow(['abierta', 'Describa una situación reciente en la que aplicó este concepto.', 'no']);

	const help = wb.addWorksheet('Instrucciones');
	help.columns = [{ width: 18 }, { width: 90 }];
	[
		['Columna', 'Cómo llenarla'],
		['tipo', '"seleccion" (una sola respuesta correcta) o "abierta" (texto libre).'],
		['enunciado', 'Texto de la pregunta (máximo 2.000 caracteres).'],
		['obligatoria', '"si" o "no". Si se deja vacía, la pregunta es obligatoria.'],
		['opcion_1 … opcion_6', 'Solo para "seleccion": entre 2 y 6 opciones, sin dejar huecos.'],
		['correcta', 'Solo para "seleccion": número de la opción correcta (1 a 6) o letra (A a F).'],
		['', ''],
		['Notas', 'La primera hoja es la que se importa. Puede guardar como .xlsx o .csv.'],
		['', 'Si alguna fila tiene errores, no se importa nada y se muestra el detalle por fila.']
	].forEach((r) => help.addRow(r));
	help.getRow(1).font = { bold: true };

	return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
