import ExcelJS from 'exceljs';
import type { Report } from '../services/reports';
import { STATUS_TEXT, type ExportMeta } from './common';
import { toLocalDateTimeInput } from '../../datetime';

// Excel del reporte con cuatro hojas: Resumen, Por pregunta, Por participante y
// Respuestas abiertas. Los porcentajes se guardan como números con formato de
// porcentaje (no como texto), para que se puedan ordenar y graficar en Excel.

const HEADER_FILL: ExcelJS.Fill = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFE2E8F0' }
};
const EXPECTED_FILL: ExcelJS.Fill = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFE0E7FF' }
};
const PCT = '0%';

function styleHeader(row: ExcelJS.Row) {
	row.font = { bold: true };
	row.alignment = { vertical: 'middle', wrapText: true };
	row.eachCell((c) => (c.fill = HEADER_FILL));
}

/**
 * Excel no maneja zonas horarias: muestra la fecha tal cual (en UTC). Se convierte
 * a la hora "de reloj" de la zona del assessment para que coincida con la pantalla.
 */
function excelDate(d: Date | null, timeZone: string): Date | string {
	if (!d) return '';
	return new Date(`${toLocalDateTimeInput(d, timeZone)}:00Z`);
}

/** Evita que un texto que empieza con =, +, - o @ se interprete como fórmula (inyección CSV/Excel). */
export function safeText(v: string | null | undefined): string {
	if (!v) return '';
	return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildExcel(meta: ExportMeta, report: Report): Promise<ArrayBuffer> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Plataforma de Assessments';
	wb.created = new Date();
	const s = report.summary;

	// ---- 1. Resumen --------------------------------------------------------
	const resumen = wb.addWorksheet('Resumen');
	resumen.columns = [{ width: 34 }, { width: 70 }];
	resumen.addRow([safeText(meta.title)]).font = { bold: true, size: 14 };
	if (meta.description) resumen.addRow([safeText(meta.description)]);
	resumen.addRow([]);
	const info: [string, string | number | null, string?][] = [
		['Periodo', meta.period],
		['Zona horaria', meta.timezone],
		['Participantes incluidos', meta.filtersLabel],
		['Generado', meta.generatedAt],
		['', ''],
		['Participantes', s.invited],
		['Entregas', s.submitted],
		['En progreso (no incluidos)', s.inProgress],
		['Tasa de participación', s.participationRate, PCT],
		['Alineación promedio', s.averageAlignment, PCT]
	];
	for (const [label, value, fmt] of info) {
		const row = resumen.addRow([label, value ?? '—']);
		row.getCell(1).font = { bold: true };
		if (fmt && typeof value === 'number') row.getCell(2).numFmt = fmt;
		row.getCell(2).alignment = { horizontal: 'left' };
	}
	for (const [title, list] of [
		['Preguntas con mayor alineación', s.mostAligned],
		['Preguntas con menor alineación', s.leastAligned]
	] as const) {
		if (!list.length) continue;
		resumen.addRow([]);
		resumen.addRow([title]).font = { bold: true };
		for (const c of list) {
			const row = resumen.addRow([`${c.number}. ${safeText(c.prompt)}`, c.alignmentRate]);
			row.getCell(2).numFmt = PCT;
			row.getCell(2).alignment = { horizontal: 'left' };
		}
	}
	resumen.addRow([]);
	resumen.addRow([
		'Nota',
		'La alineación es el porcentaje de quienes respondieron una pregunta de selección que eligió la opción esperada. Solo se incluyen entregas finales.'
	]).alignment = { wrapText: true, vertical: 'top' };

	// ---- 2. Por pregunta ---------------------------------------------------
	const porPregunta = wb.addWorksheet('Por pregunta', { views: [{ state: 'frozen', ySplit: 1 }] });
	porPregunta.columns = [
		{ header: 'N°', width: 6 },
		{ header: 'Pregunta', width: 55 },
		{ header: 'Opción', width: 45 },
		{ header: 'Esperada', width: 10 },
		{ header: 'Personas', width: 10 },
		{ header: '% de quienes respondieron', width: 16 }
	];
	styleHeader(porPregunta.getRow(1));
	for (const c of report.choice) {
		for (const o of c.options) {
			const row = porPregunta.addRow([
				c.number,
				safeText(c.prompt),
				safeText(o.text),
				o.isExpected ? 'Sí' : '',
				o.count,
				c.respondents ? o.rate : null
			]);
			row.getCell(6).numFmt = PCT;
			row.alignment = { vertical: 'top', wrapText: true };
			if (o.isExpected) row.eachCell((cell) => (cell.fill = EXPECTED_FILL));
		}
		const total = porPregunta.addRow([
			c.number,
			'',
			`Alineación (respondieron ${c.respondents}${c.omitted ? `, omitieron ${c.omitted}` : ''})`,
			'',
			c.aligned,
			c.alignmentRate
		]);
		total.font = { bold: true };
		total.getCell(6).numFmt = PCT;
		porPregunta.addRow([]);
	}

	// ---- 3. Por participante -----------------------------------------------
	const porParticipante = wb.addWorksheet('Por participante', {
		views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }]
	});
	const choiceCols = report.choice.map((c) => ({ header: `P${c.number}`, width: 28, id: c.id }));
	porParticipante.columns = [
		{ header: 'Nombre', width: 28 },
		{ header: 'Email', width: 30 },
		{ header: 'Área', width: 18 },
		{ header: 'Cargo', width: 18 },
		{ header: 'Estado', width: 13 },
		{ header: 'Inicio', width: 18 },
		{ header: 'Entrega', width: 18 },
		...choiceCols.map(({ header, width }) => ({ header, width }))
	];
	styleHeader(porParticipante.getRow(1));
	for (const p of report.participants) {
		const answers = report.answersByParticipant[p.id] ?? {};
		const row = porParticipante.addRow([
			safeText(p.name),
			safeText(p.email),
			safeText(p.area),
			safeText(p.cargo),
			STATUS_TEXT[p.status],
			excelDate(p.startedAt, meta.timezone),
			excelDate(p.submittedAt, meta.timezone),
			...choiceCols.map((c) => safeText(answers[c.id]))
		]);
		row.getCell(6).numFmt = 'yyyy-mm-dd hh:mm';
		row.getCell(7).numFmt = 'yyyy-mm-dd hh:mm';
	}
	if (report.participants.length) {
		porParticipante.autoFilter = { from: 'A1', to: { row: 1, column: 7 + choiceCols.length } };
	}
	// Referencia de las preguntas al pie, para leer las columnas P1, P2…
	if (choiceCols.length) {
		porParticipante.addRow([]);
		porParticipante.addRow(['Preguntas']).font = { bold: true };
		for (const c of report.choice) porParticipante.addRow([`P${c.number}`, safeText(c.prompt)]);
	}

	// ---- 4. Respuestas abiertas --------------------------------------------
	const abiertas = wb.addWorksheet('Respuestas abiertas', {
		views: [{ state: 'frozen', ySplit: 1 }]
	});
	abiertas.columns = [
		{ header: 'N°', width: 6 },
		{ header: 'Pregunta', width: 40 },
		{ header: 'Nombre', width: 26 },
		{ header: 'Email', width: 28 },
		{ header: 'Área', width: 16 },
		{ header: 'Cargo', width: 16 },
		{ header: 'Respuesta', width: 100 }
	];
	styleHeader(abiertas.getRow(1));
	for (const q of report.open) {
		for (const r of q.responses) {
			abiertas.addRow([
				q.number,
				safeText(q.prompt),
				safeText(r.participantName),
				safeText(r.email),
				safeText(r.area),
				safeText(r.cargo),
				safeText(r.text)
			]).alignment = { vertical: 'top', wrapText: true };
		}
	}
	if (abiertas.rowCount > 1) abiertas.autoFilter = { from: 'A1', to: 'G1' };

	return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
