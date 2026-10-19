import { reportDownload } from '#lib/server/export/download.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => reportDownload(event, 'xlsx');
