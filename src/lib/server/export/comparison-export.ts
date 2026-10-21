import ExcelJS from 'exceljs';
import pdfmake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Comparison, GroupComparison } from '../services/comparison';
import { formatPercent, formatPoints, formatShortDate } from '../../format';
import { safeText } from './excel';
import { BAR_W, C, bar, configurePdf, lightRows, noBorders, statRow } from './pdf';

// Exportaciones del comparativo entre mediciones (Excel y PDF).

export type ComparisonExportMeta = {
	title: string;
	generatedAt: string;
	logoDataUrl?: string;
	themePrimary?: string;
	themeAccent?: string;
};

const PCT = '0%';
const PP = '+0" pp";-0" pp";0" pp"';
const HEADER_FILL: ExcelJS.Fill = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFE2E8F0' }
};
const modeText = (c: Comparison) =>
	c.mode === 'pareado'
		? `Solo personas que respondieron todas las mediciones (${c.summary.paired})`
		: 'Todas las entregas de cada medición';
const label = (m: Comparison['measurements'][number]) =>
	`Medición ${m.order} (${formatShortDate(m.startsAt, m.timezone)})`;
/** Diferencia en puntos (número, para el formato "+12 pp" de Excel). */
const points = (d: number | null) => (d === null ? '—' : Math.round(d * 100));
const pct = (v: number | null) => v ?? '—';

// ---- Excel ---------------------------------------------------------------------

function sheet(wb: ExcelJS.Workbook, name: string, headers: string[], widths: number[]) {
	const ws = wb.addWorksheet(name);
	ws.columns = widths.map((width) => ({ width }));
	const row = ws.addRow(headers);
	row.font = { bold: true };
	row.alignment = { vertical: 'middle', wrapText: true };
	row.eachCell((cell) => (cell.fill = HEADER_FILL));
	ws.views = [{ state: 'frozen', ySplit: 1 }];
	return ws;
}

function formatRow(row: ExcelJS.Row, pctCols: number[], ppCol?: number) {
	for (const c of pctCols) row.getCell(c).numFmt = PCT;
	if (ppCol) row.getCell(ppCol).numFmt = PP;
}

export async function buildComparisonExcel(
	meta: ComparisonExportMeta,
	c: Comparison
): Promise<ArrayBuffer> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Plataforma de Assessments';
	wb.created = new Date();
	const n = c.measurements.length;
	const ms = c.measurements.map(label);
	const range = (from: number) => Array.from({ length: n }, (_, i) => from + i);

	const resumen = wb.addWorksheet('Resumen');
	resumen.columns = [{ width: 36 }, ...c.measurements.map(() => ({ width: 22 })), { width: 14 }];
	resumen.addRow([`Comparativo · ${safeText(meta.title)}`]).font = { bold: true, size: 14 };
	resumen.addRow(['Personas incluidas', modeText(c)]);
	resumen.addRow(['Generado', meta.generatedAt]);
	resumen.addRow([]);
	const head = resumen.addRow(['', ...ms.map(safeText), 'Diferencia']);
	head.font = { bold: true };
	head.eachCell((cell) => (cell.fill = HEADER_FILL));
	resumen.addRow(['Assessment', ...c.measurements.map((m) => safeText(m.title))]);
	resumen.addRow(['Entregas incluidas', ...c.measurements.map((m) => m.submitted)]);
	formatRow(
		resumen.addRow([
			'Acierto promedio',
			...c.measurements.map((m) => pct(m.averageScore)),
			points(c.summary.delta)
		]),
		range(2),
		n + 2
	);
	formatRow(
		resumen.addRow([
			'Alineación promedio',
			...c.measurements.map((m) => pct(m.averageAlignment)),
			points(c.summary.alignmentDelta)
		]),
		range(2),
		n + 2
	);

	const preguntas = sheet(
		wb,
		'Por pregunta',
		[
			'#',
			'Pregunta',
			...ms,
			'Diferencia',
			'Mejoraron',
			'Siguieron bien',
			'Empeoraron',
			'Siguieron mal'
		],
		[5, 60, ...c.measurements.map(() => 16), 12, 12, 14, 12, 14]
	);
	for (const q of c.choice) {
		const t = q.transitions;
		formatRow(
			preguntas.addRow([
				q.position,
				safeText(q.prompt),
				...q.rates.map(pct),
				points(q.delta),
				t?.improved ?? '—',
				t?.keptRight ?? '—',
				t?.worsened ?? '—',
				t?.keptWrong ?? '—'
			]),
			range(3),
			n + 3
		);
		for (const o of q.options) {
			const row = preguntas.addRow([
				'',
				`   ${o.isExpected ? '✓ ' : ''}${safeText(o.text)}`,
				...o.rates.map(pct)
			]);
			row.font = { color: { argb: o.isExpected ? 'FF2A3CC9' : 'FF5B6474' } };
			formatRow(row, range(3));
		}
	}

	const personas = sheet(
		wb,
		'Por persona',
		['Nombre', 'Email', 'Área', 'Cargo', ...ms, 'Diferencia'],
		[28, 32, 18, 18, ...c.measurements.map(() => 16), 12]
	);
	for (const p of c.people) {
		formatRow(
			personas.addRow([
				safeText(p.name),
				safeText(p.email),
				safeText(p.area),
				safeText(p.cargo),
				...p.scores.map(pct),
				points(p.delta)
			]),
			range(5),
			n + 5
		);
	}

	for (const [name, col, groups] of [
		['Por área', 'Área', c.byArea],
		['Por cargo', 'Cargo', c.byCargo]
	] as const) {
		const ws = sheet(
			wb,
			name,
			[col, ...ms.flatMap((m) => [m, 'Entregas']), 'Diferencia'],
			[26, ...c.measurements.flatMap(() => [16, 10]), 12]
		);
		for (const g of groups) {
			const row = ws.addRow([
				safeText(g.name),
				...g.scores.flatMap((s, i) => [pct(s), g.counts[i]]),
				points(g.delta)
			]);
			formatRow(
				row,
				range(0).map((i) => 2 + i * 2),
				2 * n + 2
			);
		}
	}

	if (c.open.length) {
		const abiertas = sheet(
			wb,
			'Respuestas abiertas',
			['Pregunta', 'Persona', ...ms],
			[40, 26, ...c.measurements.map(() => 50)]
		);
		for (const q of c.open) {
			for (const r of q.responses) {
				const row = abiertas.addRow([
					safeText(`${q.position}. ${q.prompt}`),
					safeText(r.name),
					...r.texts.map((t) => safeText(t ?? ''))
				]);
				row.alignment = { vertical: 'top', wrapText: true };
			}
		}
	}

	return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// ---- PDF -------------------------------------------------------------------------

function groupTable(c: Comparison, groups: GroupComparison[], title: string): Content {
	return {
		table: {
			headerRows: 1,
			widths: ['*', ...c.measurements.map(() => 62), 50],
			body: [
				[
					{ text: title, style: 'th' },
					...c.measurements.map((m) => ({
						text: `Medición ${m.order}`,
						style: 'th',
						alignment: 'right' as const
					})),
					{ text: 'Diferencia', style: 'th', alignment: 'right' as const }
				],
				...groups.map((g) => [
					{ text: g.name, fontSize: 9, italics: g.name === 'Sin dato' },
					...g.scores.map((s, i) => ({
						text: `${formatPercent(s)} (${g.counts[i]})`,
						fontSize: 9,
						alignment: 'right' as const
					})),
					{ text: formatPoints(g.delta), fontSize: 9, alignment: 'right' as const, bold: true }
				])
			]
		},
		layout: lightRows,
		margin: [0, 0, 0, 14]
	};
}

export function buildComparisonPdfDefinition(
	meta: ComparisonExportMeta,
	c: Comparison
): TDocumentDefinitions {
	const accent = meta.themeAccent ?? C.accent;
	const heading = meta.themePrimary ?? C.ink;
	const s = c.summary;
	const right = 'right' as const;

	const cover: Content[] = [
		meta.logoDataUrl ? { image: meta.logoDataUrl, fit: [160, 70], margin: [0, 110, 0, 0] } : '',
		{
			text: 'Comparativo entre mediciones',
			style: 'kicker',
			margin: [0, meta.logoDataUrl ? 36 : 180, 0, 8]
		},
		{ text: meta.title, style: 'coverTitle' },
		{
			margin: [0, 30, 0, 0],
			table: {
				widths: [110, '*'],
				body: [
					...c.measurements.map((m) => [
						`Medición ${m.order}`,
						`${m.title} · ${formatShortDate(m.startsAt, m.timezone)}`
					]),
					['Personas', modeText(c)],
					['Generado', meta.generatedAt]
				].map(([k, v]) => [
					{ text: k, color: C.muted, fontSize: 10 },
					{ text: v, fontSize: 10 }
				])
			},
			layout: noBorders
		},
		{ text: '', pageBreak: 'after' }
	];

	const body: Content[] = [
		{ text: 'Resumen', style: 'h1' },
		statRow([
			{
				label: 'Acierto: antes y después',
				value: `${formatPercent(s.firstScore)} a ${formatPercent(s.lastScore)}`
			},
			{ label: 'Diferencia', value: formatPoints(s.delta) },
			{
				label: 'Alineación: antes y después',
				value: `${formatPercent(s.firstAlignment)} a ${formatPercent(s.lastAlignment)}`
			},
			{ label: 'Respondieron todas', value: String(s.paired) }
		]),
		{
			text: 'Diferencias en puntos porcentuales (pp), de la primera a la última medición. Acierto: % de preguntas de selección respondidas con la opción esperada, por persona. Alineación: % de quienes respondieron cada pregunta que eligió la opción esperada.',
			style: 'note',
			margin: [0, 0, 0, 14]
		},
		{ text: 'Acierto promedio por medición', style: 'h2' },
		{
			table: {
				widths: [150, BAR_W, 50],
				body: c.measurements.map((m) => [
					{ text: label(m), fontSize: 9 },
					bar(m.averageScore ?? 0, true, accent),
					{ text: formatPercent(m.averageScore), fontSize: 9, alignment: right, bold: true }
				])
			},
			layout: noBorders,
			margin: [0, 0, 0, 14]
		},
		...(c.choice.length
			? [
					{ text: 'Alineación por pregunta', style: 'h2' } as Content,
					{
						table: {
							headerRows: 1,
							widths: [
								'*',
								...c.measurements.map(() => 50),
								46,
								...(c.choice[0].transitions ? [70] : [])
							],
							body: [
								[
									{ text: 'Pregunta', style: 'th' },
									...c.measurements.map((m) => ({
										text: `Med. ${m.order}`,
										style: 'th',
										alignment: right
									})),
									{ text: 'Dif.', style: 'th', alignment: right },
									...(c.choice[0].transitions
										? [{ text: 'Mejoraron / empeoraron', style: 'th', alignment: right }]
										: [])
								],
								...c.choice.map((q) => [
									{ text: `${q.position}. ${q.prompt}`, fontSize: 9 },
									...q.rates.map((r) => ({
										text: formatPercent(r),
										fontSize: 9,
										alignment: right
									})),
									{ text: formatPoints(q.delta), fontSize: 9, alignment: right, bold: true },
									...(q.transitions
										? [
												{
													text: `+${q.transitions.improved} / −${q.transitions.worsened}`,
													fontSize: 9,
													alignment: right
												}
											]
										: [])
								])
							]
						},
						layout: lightRows,
						margin: [0, 0, 0, 14]
					} as Content
				]
			: []),
		...(c.byArea.length
			? [{ text: 'Por área', style: 'h2' } as Content, groupTable(c, c.byArea, 'Área')]
			: []),
		...(c.byCargo.length
			? [{ text: 'Por cargo', style: 'h2' } as Content, groupTable(c, c.byCargo, 'Cargo')]
			: []),
		...(c.people.length
			? [
					{ text: 'Acierto por persona', style: 'h2', pageBreak: 'before' } as Content,
					{
						table: {
							headerRows: 1,
							widths: ['*', 90, ...c.measurements.map(() => 50), 46],
							body: [
								[
									{ text: 'Persona', style: 'th' },
									{ text: 'Área', style: 'th' },
									...c.measurements.map((m) => ({
										text: `Med. ${m.order}`,
										style: 'th',
										alignment: right
									})),
									{ text: 'Dif.', style: 'th', alignment: right }
								],
								...c.people.map((p) => [
									{ text: p.name, fontSize: 9 },
									{ text: p.area ?? '—', fontSize: 9 },
									...p.scores.map((x) => ({
										text: formatPercent(x),
										fontSize: 9,
										alignment: right
									})),
									{ text: formatPoints(p.delta), fontSize: 9, alignment: right, bold: true }
								])
							]
						},
						layout: lightRows
					} as Content
				]
			: []),
		{
			text: 'Las respuestas abiertas de cada medición, lado a lado, están en el archivo Excel.',
			style: 'note',
			margin: [0, 10, 0, 0]
		}
	];

	return {
		pageSize: 'A4',
		pageMargins: [48, 56, 48, 56],
		info: { title: `Comparativo: ${meta.title}`, creator: 'Plataforma de Assessments' },
		defaultStyle: { font: 'Roboto', fontSize: 10, color: C.ink, lineHeight: 1.25 },
		header: (page) =>
			page === 1
				? ''
				: { text: `Comparativo · ${meta.title}`, style: 'running', margin: [48, 24, 48, 0] },
		footer: (page, pages) =>
			page === 1
				? ''
				: {
						text: `Página ${page} de ${pages}`,
						style: 'running',
						alignment: 'right',
						margin: [48, 16, 48, 0]
					},
		content: [...cover, ...body],
		styles: {
			kicker: { fontSize: 11, color: accent, bold: true },
			coverTitle: { fontSize: 24, bold: true, lineHeight: 1.1, color: heading },
			h1: { fontSize: 16, bold: true, margin: [0, 0, 0, 10], color: heading },
			h2: { fontSize: 12, bold: true, margin: [0, 6, 0, 6] },
			th: { fontSize: 9, bold: true, color: C.muted },
			statLabel: { fontSize: 9, color: C.muted },
			statValue: { fontSize: 16, bold: true },
			note: { fontSize: 8.5, color: C.muted, italics: true },
			running: { fontSize: 8, color: C.muted }
		}
	};
}

export async function buildComparisonPdf(
	meta: ComparisonExportMeta,
	c: Comparison
): Promise<Buffer> {
	configurePdf();
	return pdfmake.createPdf(buildComparisonPdfDefinition(meta, c)).getBuffer();
}
