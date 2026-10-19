import ExcelJS from 'exceljs';
import { participantSchema, type ParticipantInput } from '../../schemas/participant';
import { cellGetter, type Table } from './table';

// Formato: nombre | email | area | cargo | (cualquier otra columna se guarda como dato adicional)

const NAME_COLS = ['nombre', 'nombre_completo', 'name'];
const EMAIL_COLS = ['email', 'correo', 'correo_electronico', 'e_mail'];
const AREA_COLS = ['area', 'departamento'];
const CARGO_COLS = ['cargo', 'puesto', 'rol'];
const KNOWN = new Set([...NAME_COLS, ...EMAIL_COLS, ...AREA_COLS, ...CARGO_COLS]);

export type ParticipantImportResult =
	{ ok: true; participants: ParticipantInput[] } | { ok: false; errors: string[] };

export function parseParticipantRows(table: Table): ParticipantImportResult {
	const has = (cols: string[]) => cols.some((c) => table.headers.includes(c));
	if (!has(NAME_COLS) || !has(EMAIL_COLS)) {
		return {
			ok: false,
			errors: ['El archivo debe tener las columnas "nombre" y "email". Descargue la plantilla.']
		};
	}

	const get = cellGetter(table.headers);
	const extraCols = table.headers.map((h, i) => ({ h, i })).filter(({ h }) => h && !KNOWN.has(h));

	const errors: string[] = [];
	const seen = new Map<string, number>();
	const out: ParticipantInput[] = [];

	table.rows.forEach((row, i) => {
		const rowNum = i + 2;
		const extra: Record<string, string> = {};
		for (const { h, i: col } of extraCols) {
			const v = (row[col] ?? '').trim();
			if (v) extra[h] = v;
		}

		const parsed = participantSchema.safeParse({
			name: get(row, ...NAME_COLS),
			email: get(row, ...EMAIL_COLS),
			area: get(row, ...AREA_COLS),
			cargo: get(row, ...CARGO_COLS),
			extra: Object.keys(extra).length ? extra : null
		});

		if (!parsed.success) {
			errors.push(`Fila ${rowNum}: ${parsed.error.issues[0].message}`);
			return;
		}
		const prev = seen.get(parsed.data.email);
		if (prev) {
			errors.push(`Fila ${rowNum}: el email ${parsed.data.email} ya aparece en la fila ${prev}.`);
			return;
		}
		seen.set(parsed.data.email, rowNum);
		out.push(parsed.data);
	});

	return errors.length ? { ok: false, errors } : { ok: true, participants: out };
}

export async function buildParticipantTemplate(): Promise<ArrayBuffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Participantes');
	ws.columns = [
		{ header: 'nombre', key: 'nombre', width: 32 },
		{ header: 'email', key: 'email', width: 34 },
		{ header: 'area', key: 'area', width: 22 },
		{ header: 'cargo', key: 'cargo', width: 22 }
	];
	ws.getRow(1).font = { bold: true };
	ws.views = [{ state: 'frozen', ySplit: 1 }];
	ws.addRow(['Ana Pérez', 'ana.perez@empresa.com', 'Tecnología', 'Analista']);
	ws.addRow(['Luis Gómez', 'luis.gomez@empresa.com', 'Finanzas', 'Coordinador']);

	const help = wb.addWorksheet('Instrucciones');
	help.columns = [{ width: 16 }, { width: 90 }];
	[
		['Columna', 'Cómo llenarla'],
		['nombre', 'Obligatorio. Nombre completo.'],
		['email', 'Obligatorio. Debe ser único en el archivo.'],
		['area', 'Opcional. Se usa para filtrar los reportes.'],
		['cargo', 'Opcional. Se usa para filtrar los reportes.'],
		['Otras', 'Puede agregar más columnas (ej. "sede"): se guardan como datos adicionales.'],
		['', ''],
		['Notas', 'Si el email ya está cargado, se actualizan sus datos (no se duplica).'],
		['', 'Si alguna fila tiene errores, no se carga nada y se muestra el detalle por fila.']
	].forEach((r) => help.addRow(r));
	help.getRow(1).font = { bold: true };

	return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
