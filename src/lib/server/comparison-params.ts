import type { ComparisonMode } from './services/comparison';

/** Modo y mediciones elegidas desde la URL (?modo=todos&m=<id>&m=<id>). Ids ajenos se ignoran. */
export function comparisonParams(url: URL, seriesIds: string[]) {
	const mode: ComparisonMode = url.searchParams.get('modo') === 'todos' ? 'todos' : 'pareado';
	const selectedIds = url.searchParams.getAll('m').filter((id) => seriesIds.includes(id));
	return { mode, selectedIds };
}
