import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import pdfmake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { ChoiceStat, Report } from '../services/reports';
import type { ExportMeta } from './common';
import { formatPercent } from '../../format';
import { FREQUENCY_LABELS, type StoredAnalysis } from '../../ai-analysis';

// Informe PDF: portada, resumen, gráfico y tabla por pregunta, y el análisis con IA
// de las preguntas abiertas. Se genera en el servidor con pdfmake (gráficos vectoriales).

// Paleta (validada para contraste): acento para lo destacado, gris para el resto.
const C = {
	ink: '#0e1726',
	muted: '#5b6474',
	accent: '#0b7a6e',
	accentSoft: '#e2f3f0',
	bar: '#94a3b8',
	rule: '#e2e8f0'
};

// ---- Fuentes y política de acceso --------------------------------------------
// Roboto viene con pdfmake. Solo se permite leer esa carpeta del disco y ninguna URL:
// un texto escrito por un usuario no puede hacer que el servidor lea archivos o descargue nada.
const require = createRequire(import.meta.url);
const FONT_DIR = resolve(dirname(require.resolve('pdfmake')), '..', 'fonts', 'Roboto');
const font = (f: string) => join(FONT_DIR, f);

let configured = false;
function configure() {
	if (configured) return;
	pdfmake.setFonts({
		Roboto: {
			normal: font('Roboto-Regular.ttf'),
			bold: font('Roboto-Medium.ttf'),
			italics: font('Roboto-Italic.ttf'),
			bolditalics: font('Roboto-MediumItalic.ttf')
		}
	});
	pdfmake.setLocalAccessPolicy((path) => resolve(path).startsWith(FONT_DIR + sep));
	pdfmake.setUrlAccessPolicy(() => false);
	configured = true;
}

// ---- Piezas -----------------------------------------------------------------

const BAR_W = 190;
const BAR_H = 9;

/** Barra horizontal vectorial (extremo redondeado), proporcional a `rate`. */
function bar(rate: number, highlight: boolean, accent: string = C.accent): Content {
	const w = Math.max(rate * BAR_W, rate > 0 ? 1.5 : 0);
	return {
		canvas: w
			? [{ type: 'rect', x: 0, y: 1, w, h: BAR_H, r: 2, color: highlight ? accent : C.bar }]
			: [{ type: 'line', x1: 0, y1: 1, x2: 0, y2: BAR_H + 1, lineWidth: 0.5, lineColor: C.rule }]
	};
}

const noBorders = {
	hLineWidth: () => 0,
	vLineWidth: () => 0,
	paddingLeft: () => 0,
	paddingRight: () => 6,
	paddingTop: () => 3,
	paddingBottom: () => 3
};

const lightRows = {
	hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
		i === 0 || i === node.table.body.length ? 0 : 0.5,
	vLineWidth: () => 0,
	hLineColor: () => C.rule,
	paddingLeft: () => 4,
	paddingRight: () => 4,
	paddingTop: () => 4,
	paddingBottom: () => 4
};

function statRow(items: { label: string; value: string }[]): Content {
	return {
		columns: items.map((it) => ({
			stack: [
				{ text: it.label, style: 'statLabel' },
				{ text: it.value, style: 'statValue' }
			]
		})),
		columnGap: 12,
		margin: [0, 0, 0, 12]
	};
}

function choiceSection(c: ChoiceStat, accent: string): Content {
	const pct = (rate: number) => formatPercent(c.respondents ? rate : null);
	return {
		unbreakable: true,
		margin: [0, 0, 0, 16],
		stack: [
			{ text: `${c.number}. ${c.prompt}`, style: 'questionTitle' },
			{
				text: [
					`${c.respondents} ${c.respondents === 1 ? 'persona respondió' : 'personas respondieron'}`,
					c.omitted ? ` · ${c.omitted} la omitieron` : '',
					' · Alineación: ',
					{ text: formatPercent(c.alignmentRate), bold: true }
				],
				style: 'questionMeta'
			},
			{
				table: {
					widths: [210, BAR_W, 60],
					body: c.options.map((o) => [
						{
							text: [
								o.text,
								// Roboto no incluye "✓": la etiqueta va solo en texto.
								o.isExpected ? { text: '  (esperada)', bold: true, color: accent } : ''
							],
							fontSize: 9
						},
						bar(o.rate, o.isExpected, accent),
						{ text: `${o.count} · ${pct(o.rate)}`, fontSize: 9, alignment: 'right' }
					])
				},
				layout: noBorders
			}
		]
	};
}

function analysisSection(a: StoredAnalysis): Content[] {
	const r = a.result;
	const list = (title: string, items: string[]): Content[] =>
		items.length
			? [
					{ text: title, style: 'h3' },
					{ ul: items, style: 'body', margin: [0, 0, 0, 6] }
				]
			: [];
	return [
		{ text: r.summary, style: 'body', margin: [0, 0, 0, 6] },
		...(r.themes.length
			? [
					{ text: 'Temas principales', style: 'h3' } as Content,
					{
						table: {
							headerRows: 1,
							widths: [120, 55, '*'],
							body: [
								[
									{ text: 'Tema', style: 'th' },
									{ text: 'Frecuencia', style: 'th' },
									{ text: 'Descripción', style: 'th' }
								],
								...r.themes.map((t) => [
									{ text: t.name, bold: true, fontSize: 9 },
									{ text: `${FREQUENCY_LABELS[t.frequency]} (~${t.approxCount})`, fontSize: 9 },
									{ text: t.description, fontSize: 9 }
								])
							]
						},
						layout: lightRows,
						margin: [0, 0, 0, 6]
					} as Content
				]
			: []),
		...list('Puntos destacados', r.highlights),
		...list('Preocupaciones recurrentes', r.concerns),
		...(r.quotes.length
			? [
					{ text: 'Citas representativas', style: 'h3' } as Content,
					...r.quotes.map(
						(q) => ({ text: `“${q}”`, style: 'quote', margin: [10, 0, 0, 4] }) as Content
					)
				]
			: []),
		{
			text: `Análisis generado con ${a.model} sobre ${a.responseCount} respuestas anónimas.`,
			style: 'note',
			margin: [0, 4, 0, 0]
		}
	];
}

// ---- Documento ----------------------------------------------------------------

export function buildPdfDefinition(
	meta: ExportMeta,
	report: Report,
	analyses: Map<string, StoredAnalysis>
): TDocumentDefinitions {
	const s = report.summary;
	// Colores del cliente si el assessment los define; si no, los de la plataforma.
	const accent = meta.themeAccent ?? C.accent;
	const heading = meta.themePrimary ?? C.ink;

	const cover: Content[] = [
		meta.logoDataUrl ? { image: meta.logoDataUrl, fit: [160, 70], margin: [0, 110, 0, 0] } : '',
		{
			text: 'Informe de resultados',
			style: 'kicker',
			margin: [0, meta.logoDataUrl ? 36 : 180, 0, 8]
		},
		{ text: meta.title, style: 'coverTitle' },
		meta.description ? { text: meta.description, style: 'coverText', margin: [0, 12, 0, 0] } : '',
		{
			margin: [0, 40, 0, 0],
			table: {
				widths: [110, '*'],
				body: [
					['Periodo', meta.period],
					['Zona horaria', meta.timezone.replaceAll('_', ' ')],
					['Participantes', meta.filtersLabel],
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

	const summary: Content[] = [
		{ text: 'Resumen general', style: 'h1' },
		statRow([
			{ label: 'Alineación promedio', value: formatPercent(s.averageAlignment) },
			{ label: 'Participantes', value: String(s.invited) },
			{ label: 'Entregas', value: String(s.submitted) },
			{ label: 'Tasa de participación', value: formatPercent(s.participationRate) }
		]),
		{
			text:
				'La alineación es el porcentaje de quienes respondieron una pregunta de selección que eligió la opción esperada. ' +
				`Solo se incluyen entregas finales (${s.inProgress} en progreso no se incluyen).`,
			style: 'note',
			margin: [0, 0, 0, 12]
		},
		...(s.mostAligned.length
			? [
					{
						columns: [
							{ title: 'Mayor alineación', list: s.mostAligned },
							{ title: 'Menor alineación', list: s.leastAligned }
						]
							.filter((g) => g.list.length)
							.map((g) => ({
								stack: [
									{ text: g.title, style: 'h3' },
									...g.list.map((c) => ({
										columns: [
											{ text: `${c.number}. ${c.prompt}`, fontSize: 9 },
											{
												text: formatPercent(c.alignmentRate),
												width: 40,
												alignment: 'right',
												bold: true,
												fontSize: 9
											}
										],
										margin: [0, 0, 0, 3]
									}))
								]
							})),
						columnGap: 20,
						margin: [0, 0, 0, 16]
					} as Content
				]
			: []),
		...(report.choice.length
			? [
					{ text: 'Alineación por pregunta', style: 'h2' } as Content,
					{
						table: {
							widths: [210, BAR_W, 60],
							body: report.choice.map((c) => [
								{ text: `${c.number}. ${c.prompt}`, fontSize: 9 },
								bar(c.alignmentRate ?? 0, true, accent),
								{ text: formatPercent(c.alignmentRate), fontSize: 9, alignment: 'right' }
							])
						},
						layout: noBorders
					} as Content
				]
			: [])
	];

	const perQuestion: Content[] = report.choice.length
		? [
				{ text: 'Resultados por pregunta', style: 'h1', pageBreak: 'before' },
				...report.choice.map((c) => choiceSection(c, accent))
			]
		: [];

	const global = analyses.get('global');
	const openSection: Content[] = report.open.length
		? [
				{ text: 'Preguntas abiertas: análisis con IA', style: 'h1', pageBreak: 'before' },
				{
					text: 'Las respuestas se enviaron a la IA sin nombres ni correos. Las respuestas completas están en el archivo Excel.',
					style: 'note',
					margin: [0, 0, 0, 12]
				},
				...(global
					? [{ text: 'Análisis global', style: 'h2' } as Content, ...analysisSection(global)]
					: []),
				...report.open.flatMap((q) => {
					const a = analyses.get(q.id);
					return [
						{ text: `${q.number}. ${q.prompt}`, style: 'h2', margin: [0, 14, 0, 4] } as Content,
						{
							text: `${q.responses.length} ${q.responses.length === 1 ? 'respuesta' : 'respuestas'}`,
							style: 'questionMeta'
						} as Content,
						...(a
							? analysisSection(a)
							: [
									{
										text: 'Aún no se ha generado el análisis con IA para esta pregunta.',
										style: 'note'
									} as Content
								])
					];
				})
			]
		: [];

	return {
		pageSize: 'A4',
		pageMargins: [48, 56, 48, 56],
		info: { title: `Informe: ${meta.title}`, creator: 'Plataforma de Assessments' },
		defaultStyle: { font: 'Roboto', fontSize: 10, color: C.ink, lineHeight: 1.25 },
		header: (page) =>
			page === 1 ? '' : { text: meta.title, style: 'running', margin: [48, 24, 48, 0] },
		footer: (page, pages) =>
			page === 1
				? ''
				: {
						text: `Página ${page} de ${pages}`,
						style: 'running',
						alignment: 'right',
						margin: [48, 16, 48, 0]
					},
		content: [...cover, ...summary, ...perQuestion, ...openSection],
		styles: {
			kicker: { fontSize: 11, color: accent, bold: true },
			coverTitle: { fontSize: 26, bold: true, lineHeight: 1.1, color: heading },
			coverText: { fontSize: 11, color: C.muted },
			h1: { fontSize: 16, bold: true, margin: [0, 0, 0, 10], color: heading },
			h2: { fontSize: 12, bold: true, margin: [0, 6, 0, 6] },
			h3: { fontSize: 10, bold: true, margin: [0, 4, 0, 3] },
			body: { fontSize: 10 },
			th: { fontSize: 9, bold: true, color: C.muted },
			statLabel: { fontSize: 9, color: C.muted },
			statValue: { fontSize: 20, bold: true },
			questionTitle: { fontSize: 11, bold: true, margin: [0, 0, 0, 2] },
			questionMeta: { fontSize: 9, color: C.muted, margin: [0, 0, 0, 6] },
			quote: { fontSize: 9, italics: true, color: '#334155' },
			note: { fontSize: 8.5, color: C.muted, italics: true },
			running: { fontSize: 8, color: C.muted }
		}
	};
}

export async function buildPdf(
	meta: ExportMeta,
	report: Report,
	analyses: Map<string, StoredAnalysis>
): Promise<Buffer> {
	configure();
	return pdfmake.createPdf(buildPdfDefinition(meta, report, analyses)).getBuffer();
}
