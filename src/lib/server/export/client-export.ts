import ExcelJS from 'exceljs';
import pdfmake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Executor } from '../db/client';
import type { Client } from '../services/clients';
import { getBrand, readClientLogo } from '../services/clients';
import type { ClientReport, GroupRow } from '../services/client-report';
import { DEFAULT_TIMEZONE, formatLongDateTime, formatPercent, formatShortDate } from '../../format';
import { isHexColor } from '../../theme';
import { safeText } from './excel';
import { BAR_W, C, bar, configurePdf, lightRows, noBorders, statRow } from './pdf';

// Exportaciones del informe general de un cliente (Excel y PDF), con su logo y colores.

const STATUS = { borrador: 'Borrador', publicado: 'Publicado', archivado: 'Archivado' } as const;
const PCT = '0%';
const HEADER_FILL: ExcelJS.Fill = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFE2E8F0' }
};

export type ClientExportMeta = {
	name: string;
	generatedAt: string;
	logoDataUrl?: string;
	themePrimary?: string;
	themeAccent?: string;
};

export function clientExportMeta(db: Executor, client: Client, now = new Date()): ClientExportMeta {
	const brand = getBrand(db, client.id);
	const logo = readClientLogo(db, client.id);
	return {
		name: client.name,
		generatedAt: formatLongDateTime(now, DEFAULT_TIMEZONE),
		logoDataUrl:
			logo && (logo.mime === 'image/png' || logo.mime === 'image/jpeg')
				? `data:${logo.mime};base64,${logo.data.toString('base64')}`
				: undefined,
		themePrimary:
			brand?.themePrimary && isHexColor(brand.themePrimary) ? brand.themePrimary : undefined,
		themeAccent: brand?.themeAccent && isHexColor(brand.themeAccent) ? brand.themeAccent : undefined
	};
}

const period = (a: ClientReport['assessments'][number]) =>
	`${formatShortDate(a.startsAt, a.timezone)} – ${formatShortDate(a.endsAt, a.timezone)}`;

// ---- Excel ---------------------------------------------------------------------

function header(ws: ExcelJS.Worksheet, labels: string[]) {
	const row = ws.addRow(labels);
	row.font = { bold: true };
	row.alignment = { vertical: 'middle', wrapText: true };
	row.eachCell((c) => (c.fill = HEADER_FILL));
	ws.views = [{ state: 'frozen', ySplit: row.number }];
}

const pctOrDash = (v: number | null) => v ?? '—';

export async function buildClientExcel(
	meta: ClientExportMeta,
	report: ClientReport
): Promise<ArrayBuffer> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Plataforma de Assessments';
	wb.created = new Date();
	const s = report.summary;

	const resumen = wb.addWorksheet('Resumen');
	resumen.columns = [{ width: 34 }, { width: 50 }];
	resumen.addRow([`Informe general · ${safeText(meta.name)}`]).font = { bold: true, size: 14 };
	resumen.addRow([]);
	const info: [string, string | number | null, string?][] = [
		['Generado', meta.generatedAt],
		['', ''],
		['Assessments (sin borradores)', s.assessments],
		['Con entregas', s.withSubmissions],
		['Personas distintas', s.people],
		['Invitaciones', s.participants],
		['Entregas', s.submitted],
		['Participación', s.participationRate, PCT],
		['Acierto promedio', s.averageScore, PCT],
		['Alineación promedio', s.averageAlignment, PCT]
	];
	for (const [label, value, fmt] of info) {
		const row = resumen.addRow([label, value ?? '—']);
		row.getCell(1).font = { bold: true };
		if (fmt && typeof value === 'number') row.getCell(2).numFmt = fmt;
		row.getCell(2).alignment = { horizontal: 'left' };
	}
	resumen.addRow([]);
	resumen.addRow([
		'Acierto: % de preguntas de selección respondidas con la opción esperada, promediado por persona. Solo entregas finales.'
	]).font = { italic: true, color: { argb: 'FF5B6474' } };

	const list = wb.addWorksheet('Assessments');
	list.columns = [
		{ width: 44 },
		{ width: 24 },
		{ width: 12 },
		{ width: 14 },
		{ width: 12 },
		{ width: 14 },
		{ width: 12 },
		{ width: 12 }
	];
	header(list, [
		'Assessment',
		'Periodo',
		'Estado',
		'Participantes',
		'Entregas',
		'Participación',
		'Alineación',
		'Acierto'
	]);
	for (const a of report.assessments) {
		const row = list.addRow([
			safeText(a.title),
			period(a),
			STATUS[a.status],
			a.participants,
			a.submitted,
			pctOrDash(a.participationRate),
			pctOrDash(a.averageAlignment),
			pctOrDash(a.averageScore)
		]);
		for (const col of [6, 7, 8]) row.getCell(col).numFmt = PCT;
	}

	for (const [title, label, groups] of [
		['Por área', 'Área', report.byArea],
		['Por cargo', 'Cargo', report.byCargo]
	] as const) {
		const ws = wb.addWorksheet(title);
		ws.columns = [
			{ width: 28 },
			{ width: 12 },
			{ width: 14 },
			...report.assessments.map(() => ({ width: 18 }))
		];
		header(ws, [
			label,
			'Entregas',
			'Acierto total',
			...report.assessments.map((a) => safeText(a.title))
		]);
		for (const g of groups) {
			const row = ws.addRow([
				safeText(g.name),
				g.submissions,
				pctOrDash(g.averageScore),
				...report.assessments.map((a) => pctOrDash(g.byAssessment[a.id] ?? null))
			]);
			for (let col = 3; col <= 3 + report.assessments.length; col++) row.getCell(col).numFmt = PCT;
		}
	}

	return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// ---- PDF -------------------------------------------------------------------------

function groupTable(groups: GroupRow[], label: string, accent: string): Content {
	return {
		table: {
			headerRows: 1,
			widths: [150, 50, BAR_W, 50],
			body: [
				[
					{ text: label, style: 'th' },
					{ text: 'Entregas', style: 'th', alignment: 'right' as const },
					{ text: '', style: 'th' },
					{ text: 'Acierto', style: 'th', alignment: 'right' as const }
				],
				...groups.map((g) => [
					{ text: g.name, fontSize: 9, italics: g.name === 'Sin dato' },
					{ text: String(g.submissions), fontSize: 9, alignment: 'right' as const },
					bar(g.averageScore ?? 0, true, accent),
					{
						text: formatPercent(g.averageScore),
						fontSize: 9,
						alignment: 'right' as const,
						bold: true
					}
				])
			]
		},
		layout: noBorders,
		margin: [0, 0, 0, 14]
	};
}

export function buildClientPdfDefinition(
	meta: ClientExportMeta,
	report: ClientReport
): TDocumentDefinitions {
	const s = report.summary;
	const accent = meta.themeAccent ?? C.accent;
	const heading = meta.themePrimary ?? C.ink;

	const cover: Content[] = [
		meta.logoDataUrl ? { image: meta.logoDataUrl, fit: [160, 70], margin: [0, 110, 0, 0] } : '',
		{ text: 'Informe general', style: 'kicker', margin: [0, meta.logoDataUrl ? 36 : 180, 0, 8] },
		{ text: meta.name, style: 'coverTitle' },
		{
			text: `${s.assessments} ${s.assessments === 1 ? 'assessment' : 'assessments'} · generado el ${meta.generatedAt}`,
			style: 'coverText',
			margin: [0, 12, 0, 0]
		},
		{ text: '', pageBreak: 'after' }
	];

	const body: Content[] = [
		{ text: 'Resumen', style: 'h1' },
		statRow([
			{ label: 'Acierto promedio', value: formatPercent(s.averageScore) },
			{ label: 'Alineación promedio', value: formatPercent(s.averageAlignment) },
			{ label: 'Entregas', value: `${s.submitted} de ${s.participants}` },
			{ label: 'Personas distintas', value: String(s.people) }
		]),
		{
			text:
				'Acierto: porcentaje de preguntas de selección que cada persona respondió con la opción esperada, promediado entre quienes entregaron. ' +
				'Alineación: porcentaje de quienes respondieron cada pregunta que eligió la opción esperada. Solo cuentan entregas finales.',
			style: 'note',
			margin: [0, 0, 0, 14]
		},
		{ text: 'Acierto promedio por assessment', style: 'h2' },
		{
			table: {
				// La barra mide BAR_W: su columna debe tener al menos ese ancho.
				widths: [150, 64, BAR_W, 44],
				body: report.assessments.map((a) => [
					{ text: a.title, fontSize: 9 },
					{ text: period(a), fontSize: 8, color: C.muted },
					bar(a.averageScore ?? 0, true, accent),
					{
						text: formatPercent(a.averageScore),
						fontSize: 9,
						alignment: 'right' as const,
						bold: true
					}
				])
			},
			layout: noBorders,
			margin: [0, 0, 0, 14]
		},
		{ text: 'Detalle por assessment', style: 'h2' },
		{
			table: {
				headerRows: 1,
				widths: ['*', 52, 54, 54, 54, 44],
				body: [
					['Assessment', 'Estado', 'Entregas', 'Participación', 'Alineación', 'Acierto'].map(
						(h, i) => ({
							text: h,
							style: 'th',
							alignment: i ? ('right' as const) : ('left' as const)
						})
					),
					...report.assessments.map((a) => [
						{ text: a.title, fontSize: 9 },
						{ text: STATUS[a.status], fontSize: 9, alignment: 'right' as const },
						{
							text: `${a.submitted} de ${a.participants}`,
							fontSize: 9,
							alignment: 'right' as const
						},
						{ text: formatPercent(a.participationRate), fontSize: 9, alignment: 'right' as const },
						{ text: formatPercent(a.averageAlignment), fontSize: 9, alignment: 'right' as const },
						{
							text: formatPercent(a.averageScore),
							fontSize: 9,
							alignment: 'right' as const,
							bold: true
						}
					])
				]
			},
			layout: lightRows,
			margin: [0, 0, 0, 14]
		},
		...(report.byArea.length
			? [{ text: 'Por área', style: 'h2' } as Content, groupTable(report.byArea, 'Área', accent)]
			: []),
		...(report.byCargo.length
			? [{ text: 'Por cargo', style: 'h2' } as Content, groupTable(report.byCargo, 'Cargo', accent)]
			: []),
		{
			text: 'El detalle de cada área en cada assessment está en el archivo Excel.',
			style: 'note'
		}
	];

	return {
		pageSize: 'A4',
		pageMargins: [48, 56, 48, 56],
		info: { title: `Informe general: ${meta.name}`, creator: 'Plataforma de Assessments' },
		defaultStyle: { font: 'Roboto', fontSize: 10, color: C.ink, lineHeight: 1.25 },
		header: (page) =>
			page === 1
				? ''
				: { text: `Informe general · ${meta.name}`, style: 'running', margin: [48, 24, 48, 0] },
		footer: (page, pages) =>
			page === 1
				? ''
				: {
						text: `Página ${page} de ${pages}`,
						style: 'running',
						alignment: 'right' as const,
						margin: [48, 16, 48, 0]
					},
		content: [...cover, ...body],
		styles: {
			kicker: { fontSize: 11, color: accent, bold: true },
			coverTitle: { fontSize: 26, bold: true, lineHeight: 1.1, color: heading },
			coverText: { fontSize: 11, color: C.muted },
			h1: { fontSize: 16, bold: true, margin: [0, 0, 0, 10], color: heading },
			h2: { fontSize: 12, bold: true, margin: [0, 6, 0, 6] },
			th: { fontSize: 9, bold: true, color: C.muted },
			statLabel: { fontSize: 9, color: C.muted },
			statValue: { fontSize: 20, bold: true },
			note: { fontSize: 8.5, color: C.muted, italics: true },
			running: { fontSize: 8, color: C.muted }
		}
	};
}

export async function buildClientPdf(
	meta: ClientExportMeta,
	report: ClientReport
): Promise<Buffer> {
	configurePdf();
	return pdfmake.createPdf(buildClientPdfDefinition(meta, report)).getBuffer();
}
