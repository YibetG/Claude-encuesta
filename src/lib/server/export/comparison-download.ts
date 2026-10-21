import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { db } from '../db/index';
import { requireAssessment } from '../route-helpers';
import { buildComparison } from '../services/comparison';
import { seriesMembers } from '../services/series';
import { audit } from '../security/audit';
import { comparisonParams } from '../comparison-params';
import { exportFileName, exportMeta } from './common';
import { buildComparisonExcel, buildComparisonPdf } from './comparison-export';

const TYPES = {
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pdf: 'application/pdf'
} as const;

/** Descarga del comparativo (con el mismo modo y mediciones de la URL), registrada en auditoría. */
export async function comparisonDownload(
	event: RequestEvent<{ id: string }>,
	format: 'xlsx' | 'pdf'
) {
	const a = requireAssessment(event.params.id);
	const members = seriesMembers(db, a);
	if (members.length < 2) error(404, 'Este assessment no tiene otras mediciones');
	const { mode, selectedIds } = comparisonParams(
		event.url,
		members.map((m) => m.id)
	);
	const comparison = buildComparison(db, a, { mode, selectedIds });
	// Título de la serie (sin el sufijo "· Medición N"), logo y colores del cliente.
	const base = exportMeta(db, members[0], {});
	const meta = {
		title: members[0].title.replace(/ · Medición \d+$/, ''),
		generatedAt: base.generatedAt,
		logoDataUrl: base.logoDataUrl,
		themePrimary: base.themePrimary,
		themeAccent: base.themeAccent
	};
	const body =
		format === 'xlsx'
			? await buildComparisonExcel(meta, comparison)
			: await buildComparisonPdf(meta, comparison);

	audit(db, {
		adminId: event.locals.admin!.id,
		action: 'reporte.exportado',
		entityType: 'assessment',
		entityId: a.id,
		metadata: {
			formato: format === 'xlsx' ? 'Excel' : 'PDF',
			informe: 'comparativo de mediciones',
			mediciones: comparison.measurements.map((m) => m.order).join(', ')
		},
		ip: event.getClientAddress()
	});

	return new Response(new Uint8Array(body), {
		headers: {
			'Content-Type': TYPES[format],
			'Content-Disposition': `attachment; filename="${exportFileName(`comparativo ${meta.title}`, format)}"`
		}
	});
}
