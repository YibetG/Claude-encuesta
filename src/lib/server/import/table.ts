import ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';

// Lectura de archivos tabulares (Excel .xlsx o CSV) como filas de texto.
// Se usa para importar preguntas (fase 2) y participantes (fase 3).

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2 MB
/** Un .xlsx es un ZIP: tope del contenido descomprimido (protege contra "bombas ZIP"). */
const MAX_XLSX_UNZIPPED_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_COLUMNS = 50;

export type Table = { headers: string[]; rows: string[][] };

export class ImportFileError extends Error {}

/** Normaliza un encabezado: minúsculas, sin tildes, espacios → "_". "Opción 1" → "opcion_1". */
export function normalizeHeader(h: string): string {
	return h
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
}

/** Quita la marca BOM (U+FEFF) que Excel agrega al inicio de los CSV en UTF-8. */
function stripBom(s: string): string {
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Parser CSV (RFC 4180): comillas, comillas escapadas ("") y saltos de línea dentro de campos.
 * Detecta el separador: Excel en español suele exportar con ";".
 */
export function parseCsv(input: string): string[][] {
	const text = stripBom(input);
	const firstLine = text.slice(0, text.search(/\r?\n|$/));
	const delimiter =
		(firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += ch;
		} else if (ch === '"' && field === '') {
			inQuotes = true;
		} else if (ch === delimiter) {
			row.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += ch;
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

class UnzippedTooLarge extends Error {}

/**
 * Descomprime el .xlsx con tope y lo vuelve a empaquetar sin compresión. ExcelJS recibe
 * solo esa copia, nunca el archivo original: así no puede descomprimir más de `max` bytes.
 * Se usan los tamaños del directorio central (los mismos que usa ExcelJS) y fflate escribe
 * cada entrada en un buffer de ese tamaño, de modo que un tamaño falso trunca, no desborda.
 */
function rezipWithinLimit(data: Uint8Array, max: number): Uint8Array {
	let declared = 0;
	const files = unzipSync(data, {
		filter: (f) => {
			declared += f.originalSize;
			if (declared > max) throw new UnzippedTooLarge();
			return true;
		}
	});
	return zipSync(files, { level: 0 });
}

async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
	let safe: Uint8Array;
	try {
		safe = rezipWithinLimit(new Uint8Array(buffer), MAX_XLSX_UNZIPPED_BYTES);
	} catch (e) {
		if (e instanceof UnzippedTooLarge) {
			throw new ImportFileError('El archivo Excel es demasiado grande al descomprimirlo.');
		}
		throw new ImportFileError(
			'No se pudo leer el archivo Excel. Verifique que sea un .xlsx válido.'
		);
	}

	const wb = new ExcelJS.Workbook();
	try {
		await wb.xlsx.load(safe);
	} catch {
		throw new ImportFileError(
			'No se pudo leer el archivo Excel. Verifique que sea un .xlsx válido.'
		);
	}
	const sheet = wb.worksheets[0];
	if (!sheet) throw new ImportFileError('El archivo Excel no tiene hojas.');

	// Límites antes de recorrer: un archivo con una celda en la última columna/fila
	// haría que el recorrido fuera enorme aunque el archivo pese poco.
	if (sheet.columnCount > MAX_IMPORT_COLUMNS) {
		throw new ImportFileError(
			`El archivo tiene demasiadas columnas (máximo ${MAX_IMPORT_COLUMNS}).`
		);
	}
	if (sheet.actualRowCount > MAX_IMPORT_ROWS + 1) {
		throw new ImportFileError(`El archivo supera el máximo de ${MAX_IMPORT_ROWS} filas.`);
	}

	const rows: string[][] = [];
	const width = sheet.columnCount;
	// Sin includeEmpty: solo se recorren las filas con contenido.
	sheet.eachRow((r) => {
		const cells: string[] = [];
		// `cell.text` resuelve texto enriquecido, fórmulas, números e hipervínculos.
		for (let c = 1; c <= width; c++) cells.push(r.getCell(c).text ?? '');
		rows.push(cells);
	});
	return rows;
}

/** Lee el archivo subido y devuelve encabezados normalizados + filas no vacías. */
export async function readTable(file: File): Promise<Table> {
	if (!file || file.size === 0) throw new ImportFileError('Seleccione un archivo.');
	if (file.size > MAX_IMPORT_BYTES)
		throw new ImportFileError('El archivo supera el máximo de 2 MB.');

	const name = file.name.toLowerCase();
	let raw: string[][];
	if (name.endsWith('.xlsx')) raw = await readXlsx(await file.arrayBuffer());
	else if (name.endsWith('.csv')) raw = parseCsv(await file.text());
	else throw new ImportFileError('Formato no soportado. Use un archivo .xlsx o .csv.');

	const nonEmpty = raw.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
	if (nonEmpty.length < 2) throw new ImportFileError('El archivo no tiene filas de datos.');
	if (nonEmpty.length - 1 > MAX_IMPORT_ROWS) {
		throw new ImportFileError(`El archivo supera el máximo de ${MAX_IMPORT_ROWS} filas.`);
	}

	const [headerRow, ...rows] = nonEmpty;
	return { headers: headerRow.map(normalizeHeader), rows };
}

/** Acceso a una celda por nombre de columna normalizado. */
export function cellGetter(headers: string[]) {
	const index = new Map(headers.map((h, i) => [h, i]));
	return (row: string[], ...names: string[]) => {
		for (const n of names) {
			const i = index.get(n);
			if (i !== undefined) return (row[i] ?? '').trim();
		}
		return '';
	};
}
