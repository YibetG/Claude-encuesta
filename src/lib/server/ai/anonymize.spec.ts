import { describe, expect, it } from 'vitest';
import { chunkResponses, createAnonymizer } from './anonymize';

describe('anonimización', () => {
	const anon = createAnonymizer(['Ana María Pérez', 'José Gómez', 'Li']);

	it('reemplaza emails y teléfonos', () => {
		expect(anon('Escríbanme a ana.perez@empresa.com o al +57 300 123 4567.')).toBe(
			'Escríbanme a [email] o al [teléfono].'
		);
	});

	it('reemplaza nombres completos y partes, sin importar tildes ni mayúsculas', () => {
		expect(anon('Ana María Pérez y yo hablamos con jose.')).toBe(
			'[persona] y yo hablamos con [persona].'
		);
		expect(anon('Según PEREZ, el proceso falla.')).toBe('Según [persona], el proceso falla.');
	});

	it('no toca palabras que solo contienen el nombre', () => {
		// "Li" tiene menos de 3 letras: solo se reemplaza como nombre completo, y nunca dentro de otra palabra.
		expect(anon('La política de Lima es clara. Li respondió.')).toBe(
			'La política de Lima es clara. [persona] respondió.'
		);
		expect(anon('Mariano y Anabel')).toBe('Mariano y Anabel');
	});

	it('conserva tildes, emojis y el resto del texto', () => {
		expect(anon('La información está en José.')).toBe('La información está en [persona].');
		expect(anon('👍 Gracias José, 🎉 buen trabajo')).toBe('👍 Gracias [persona], 🎉 buen trabajo');
	});
});

describe('nombres maliciosos', () => {
	it('un "nombre" hecho de palabras comunes no borra el texto', () => {
		const anon = createAnonymizer(['que para con', 'Ana Ruiz']);
		expect(anon('Creo que para mejorar hay que hablar con Ruiz')).toBe(
			'Creo que para mejorar hay que hablar con [persona]'
		);
	});
});

describe('rendimiento', () => {
	it('anonimiza textos largos en poco tiempo', () => {
		const anon = createAnonymizer(['Ana María Pérez', 'José Gómez']);
		const texto = 'palabra '.repeat(50_000) + 'x'.repeat(200_000) + ' 1'.repeat(10_000);
		const t0 = performance.now();
		anon(texto);
		expect(performance.now() - t0).toBeLessThan(2000);
	});
});

describe('división en bloques', () => {
	it('agrupa sin partir respuestas y respeta el máximo', () => {
		expect(chunkResponses(['aaaa', 'bbb', 'cc', 'dddddd'], 7)).toEqual([
			['aaaa', 'bbb'],
			['cc'],
			['dddddd']
		]);
		expect(chunkResponses([], 10)).toEqual([]);
		// Una respuesta más larga que el máximo va sola en su bloque.
		expect(chunkResponses(['x'.repeat(20)], 10)).toHaveLength(1);
	});
});
