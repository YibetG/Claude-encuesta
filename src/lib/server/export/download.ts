import type { RequestEvent } from '@sveltejs/kit';
import { db } from '../db/index';
import { reportFiltersFromUrl, requireAssessment } from '../route-helpers';
import { buildReport } from '../services/reports';
import { latestAnalyses } from '../services/ai-store';
import { audit } from '../security/audit';
import { exportFileName, exportMeta } from './common';
import { buildExcel } from './excel';
import { buildPdf } from './pdf';

const TYPES = {
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pdf: 'application/pdf'
} as const;

/** Genera la descarga del reporte (respetando los filtros de la URL) y la registra en auditoría. */
export async function reportDownload(event: RequestEvent<{ id: string }>, format: 'xlsx' | 'pdf') {
	const a = requireAssessment(event.params.id);
	const { filters } = reportFiltersFromUrl(a.id, event.url);
	const report = buildReport(db, a.id, filters);
	const meta = exportMeta(a, filters);

	const body =
		format === 'xlsx'
			? await buildExcel(meta, report)
			: await buildPdf(meta, report, latestAnalyses(db, a.id));

	audit(db, {
		adminId: event.locals.admin!.id,
		action: 'reporte.exportado',
		entityType: 'assessment',
		entityId: a.id,
		metadata: { formato: format === 'xlsx' ? 'Excel' : 'PDF', filtros: meta.filtersLabel },
		ip: event.getClientAddress()
	});

	return new Response(new Uint8Array(body), {
		headers: {
			'Content-Type': TYPES[format],
			'Content-Disposition': `attachment; filename="${exportFileName(a.title, format)}"`
		}
	});
}
