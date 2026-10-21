import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { zipSync } from 'fflate';
import { MAX_IMPORT_BYTES, normalizeHeader, parseCsv, readTable } from './table';
import { buildQuestionTemplate, parseQuestionRows, TEMPLATE_HEADERS } from './questions-import';

const H = TEMPLATE_HEADERS;
const row = (o: Partial<Record<string, string>>) => H.map((h) => o[h] ?? '');

describe('lectura CSV', () => {
	it('detecta ";" como separador y respeta comillas y saltos de línea', () => {
		const csv = '﻿tipo;enunciado\nabierta;"Texto con ; y ""comillas""\ny salto"\r\nseleccion;Otra';
		expect(parseCsv(csv)).toEqual([
			['tipo', 'enunciado'],
			['abierta', 'Texto con ; y "comillas"\ny salto'],
			['seleccion', 'Otra']
		]);
	});

	it('usa "," cuando predomina', () => {
		expect(parseCsv('a,b\n1,2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('normaliza encabezados con tildes y espacios', () => {
		expect(normalizeHeader(' Opción 1 ')).toBe('opcion_1');
		expect(normalizeHeader('Enunciado')).toBe('enunciado');
	});
});

describe('importación de preguntas', () => {
	it('convierte filas válidas (número o letra para la correcta)', () => {
		const r = parseQuestionRows({
			headers: H,
			rows: [
				row({ tipo: 'Selección', enunciado: '¿2+2?', opcion_1: '3', opcion_2: '4', correcta: '2' }),
				row({
					tipo: 'seleccion',
					enunciado: '¿Color?',
					opcion_1: 'Rojo',
					opcion_2: 'Azul',
					correcta: 'a',
					obligatoria: 'no'
				}),
				row({ tipo: 'abierta', enunciado: 'Explique' })
			]
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.questions).toHaveLength(3);
		expect(r.questions[0]).toEqual({
			type: 'opcion_unica',
			prompt: '¿2+2?',
			required: true,
			options: [
				{ text: '3', isCorrect: false },
				{ text: '4', isCorrect: true }
			]
		});
		expect(r.questions[1]).toMatchObject({
			required: false,
			options: [{ isCorrect: true }, { isCorrect: false }]
		});
		expect(r.questions[2]).toEqual({ type: 'abierta', prompt: 'Explique', required: true });
	});

	it('reporta errores por fila y no importa nada', () => {
		const r = parseQuestionRows({
			headers: H,
			rows: [
				row({ tipo: 'abierta', enunciado: 'Bien' }),
				row({ tipo: 'encuesta', enunciado: 'x' }),
				row({ tipo: 'seleccion', enunciado: 'Una sola opción', opcion_1: 'A', correcta: '1' }),
				row({
					tipo: 'seleccion',
					enunciado: 'Sin correcta',
					opcion_1: 'A',
					opcion_2: 'B',
					correcta: '5'
				})
			]
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.errors).toContain(
			'Fila 3: tipo "encuesta" no reconocido (use "seleccion" o "abierta").'
		);
		expect(r.errors.some((e) => e.startsWith('Fila 5: "correcta"'))).toBe(true);
	});

	it('valida con Zod después de convertir (mínimo 2 opciones)', () => {
		const r = parseQuestionRows({
			headers: H,
			rows: [row({ tipo: 'seleccion', enunciado: 'Una sola', opcion_1: 'A', correcta: '1' })]
		});
		expect(r).toEqual({ ok: false, errors: ['Fila 2: Debe tener al menos 2 opciones.'] });
	});

	it('exige las columnas mínimas', () => {
		expect(parseQuestionRows({ headers: ['a', 'b'], rows: [['1', '2']] }).ok).toBe(false);
	});

	it('la plantilla descargable se puede importar tal cual', async () => {
		const buffer = await buildQuestionTemplate();
		const file = new File([buffer], 'plantilla.xlsx');
		const table = await readTable(file);
		const r = parseQuestionRows(table);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.questions.map((q) => q.type)).toEqual(['opcion_unica', 'abierta']);
	});

	it('rechaza Excel con dimensiones enormes antes de recorrerlo', async () => {
		const wb = new ExcelJS.Workbook();
		const ws = wb.addWorksheet('Hoja');
		ws.getCell('A1').value = 'tipo';
		ws.getCell('ZZ1').value = 'x'; // columna 702
		const file = new File([await wb.xlsx.writeBuffer()], 'grande.xlsx');
		await expect(readTable(file)).rejects.toThrow('demasiadas columnas');
	});

	it('rechaza un Excel que descomprimido es enorme (bomba ZIP) sin abrirlo con ExcelJS', async () => {
		// 30 MB de ceros se comprimen a unos pocos KB.
		const zip = zipSync({ 'xl/sharedStrings.xml': new Uint8Array(30 * 1024 * 1024) });
		expect(zip.length).toBeLessThan(MAX_IMPORT_BYTES);
		const file = new File([zip], 'bomba.xlsx');
		await expect(readTable(file)).rejects.toThrow('demasiado grande al descomprimirlo');
	});

	it('rechaza la bomba ZIP aunque el encabezado local mienta sobre el tamaño', async () => {
		const zip = zipSync({ 'xl/sharedStrings.xml': new Uint8Array(30 * 1024 * 1024) });
		// Tamaño comprimido del encabezado local en 0: un lector por streaming ve un archivo
		// vacío, pero ExcelJS (JSZip) usa el directorio central y lo descomprime entero.
		zip.fill(0, 18, 22);
		const file = new File([zip], 'bomba.xlsx');
		await expect(readTable(file)).rejects.toThrow('demasiado grande al descomprimirlo');
	});

	it('rechaza formatos no soportados', async () => {
		await expect(readTable(new File(['x'], 'preguntas.pdf'))).rejects.toThrow(
			'Formato no soportado'
		);
	});
});
