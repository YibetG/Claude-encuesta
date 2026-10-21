// Avisos de configuración insegura al iniciar el servidor en producción.
// No impiden arrancar: sin proxy, por ejemplo, ADDRESS_HEADER no hace falta.

export function productionWarnings(config: {
	addressHeader?: string;
	accessPasswordKey?: string;
}): string[] {
	const warnings: string[] = [];
	if (!config.addressHeader) {
		warnings.push(
			'ADDRESS_HEADER no está definida. Si la app corre detrás de un proxy, todas las ' +
				'personas comparten la IP del proxy y el límite de intentos las bloquea a la vez.'
		);
	}
	if (!config.accessPasswordKey) {
		warnings.push(
			'ACCESS_PASSWORD_KEY no está definida: la clave de cifrado está en un archivo junto a ' +
				'la base, y un respaldo de esa carpeta permite descifrar las contraseñas de acceso.'
		);
	}
	return warnings;
}
