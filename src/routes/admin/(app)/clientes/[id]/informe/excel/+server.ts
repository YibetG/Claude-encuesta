import { clientReportDownload } from '#lib/server/export/client-download.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => clientReportDownload(event, 'xlsx');
