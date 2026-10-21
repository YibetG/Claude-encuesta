import { comparisonDownload } from '#lib/server/export/comparison-download.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => comparisonDownload(event, 'pdf');
