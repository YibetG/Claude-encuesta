import { strToU8, zipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './fixtures';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Word mínimo: cada línea es un párrafo; las que empiezan con "_" van subrayadas. */
function docx(lines: string[]): Buffer {
	const body = lines
		.map((l) => {
			const u = l.startsWith('_');
			const text = u ? l.slice(1) : l;
			return `<w:p><w:r>${u ? '<w:rPr><w:u w:val="single"/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
		})
		.join('');
	return Buffer.from(
		zipSync({
			'word/document.xml': strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`)
		})
	);
}

test('importar preguntas desde Word: vista previa, avisos y guardado', async ({ page }) => {
	await loginAsAdmin(page);
	await page.goto('/admin');
	await page.getByRole('link', { name: 'Nuevo assessment' }).click();
	await page.getByLabel('Título').fill('Importado desde Word');
	await page.getByRole('button', { name: 'Crear y agregar preguntas' }).click();
	await expect(page).toHaveURL(/\/preguntas\?creado=1$/, { timeout: 15_000 });
	const base = page.url().replace(/\?.*$/, '');

	// La plantilla Word se descarga y sirve tal cual para importar.
	const plantilla = await page.request.get(`${base}/plantilla-word`);
	expect(plantilla.headers()['content-type']).toBe(DOCX_MIME);

	const documento = page.getByLabel('Documento (.docx, máx. 10 MB)');

	// Un archivo que no es Word se rechaza con un mensaje claro.
	await documento.setInputFiles({
		name: 'notas.docx',
		mimeType: DOCX_MIME,
		buffer: Buffer.from('hola')
	});
	await page.getByRole('button', { name: 'Leer documento' }).click();
	await expect(page.getByRole('alert')).toContainText('no es un Word .docx');

	await documento.setInputFiles({
		name: 'plantilla-preguntas.docx',
		mimeType: DOCX_MIME,
		buffer: await plantilla.body()
	});
	await page.getByRole('button', { name: 'Leer documento' }).click();
	await expect(page.getByText('se leyeron 3 preguntas de')).toBeVisible();
	await expect(page.getByText('(2 de selección · 1 abiertas)')).toBeVisible();
	// Nada se guarda todavía.
	await expect(page.getByText('Todavía no hay preguntas.')).toBeVisible();

	await page.getByRole('button', { name: 'Cargar en el editor' }).click();
	await expect(page.getByText('Se cargaron 3 preguntas del documento en el editor.')).toBeVisible();
	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByText('Preguntas guardadas.')).toBeVisible();

	await page.reload();
	await expect(page.getByLabel('Enunciado de la pregunta 2')).toHaveValue(
		'¿Qué debe hacer si recibe un correo sospechoso?'
	);
	await expect(page.getByLabel('Marcar opción 1 como correcta').first()).toBeChecked();
	await expect(page.getByLabel('Marcar opción 2 como correcta').nth(1)).toBeChecked();
	await expect(page.getByLabel('Obligatoria').nth(2)).not.toBeChecked();

	// Un documento con problemas: se avisa, se resalta en el editor y no deja guardar sin corregir.
	await documento.setInputFiles({
		name: 'borrador.docx',
		mimeType: DOCX_MIME,
		buffer: docx([
			'Evaluación rápida',
			'1. ¿Pregunta sin marca?',
			'a) Uno',
			'b) Dos',
			'2. ¿Con marca?',
			'a) Sí',
			'_b) No'
		])
	});
	await page.getByRole('button', { name: 'Leer documento' }).click();
	await expect(
		page.getByText(
			'Pregunta 1: no tiene la respuesta subrayada ni resaltada. Márquela en el editor.'
		)
	).toBeVisible();
	await page.getByRole('button', { name: 'Agregar al final del editor' }).click();
	await expect(page.getByLabel('Enunciado de la pregunta 4')).toHaveValue('¿Pregunta sin marca?');
	await expect(page.getByText('⚠ Marque la opción correcta.')).toBeVisible();

	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByRole('alert')).toContainText('Pregunta 4');

	await page.locator('#pregunta-4').getByLabel('Marcar opción 1 como correcta').check();
	await expect(page.getByText('⚠ Marque la opción correcta.')).toHaveCount(0);
	await page.getByRole('button', { name: 'Guardar preguntas' }).click();
	await expect(page.getByText('Preguntas guardadas.')).toBeVisible();
	await expect(page.getByText('5 preguntas: 4 de selección (80%) · 1 abiertas')).toBeVisible();
});
