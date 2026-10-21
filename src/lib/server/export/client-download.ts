import type { RequestEvent } from '@sveltejs/kit';
import { db } from '../db/index';
import { requireClient } from '../route-helpers';
import { buildClientReport } from '../services/client-report';
import { audit } from '../security/audit';
import { exportFileName } from './common';
import { buildClientExcel, buildClientPdf, clientExportMeta } from './client-export';

const TYPES = {
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pdf: 'application/pdf'
} as const;

/** Descarga del informe general de un cliente, registrada en la auditoría. */
export async function clientReportDownload(
	event: RequestEvent<{ id: string }>,
	format: 'xlsx' | 'pdf'
) {
	const client = requireClient(event.params.id);
	const report = buildClientReport(db, client.id);
	const meta = clientExportMeta(db, client);
	const body =
		format === 'xlsx' ? await buildClientExcel(meta, report) : await buildClientPdf(meta, report);

	audit(db, {
		adminId: event.locals.admin!.id,
		action: 'reporte.exportado',
		entityType: 'cliente',
		entityId: client.id,
		metadata: { formato: format === 'xlsx' ? 'Excel' : 'PDF', informe: 'general del cliente' },
		ip: event.getClientAddress()
	});

	return new Response(new Uint8Array(body), {
		headers: {
			'Content-Type': TYPES[format],
			'Content-Disposition': `attachment; filename="${exportFileName(`general ${client.name}`, format)}"`
		}
	});
}
