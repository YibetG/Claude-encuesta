# Seguridad: correcciones de la auditoría (2026-10-21)

Objetivo: cerrar los hallazgos de la auditoría de seguridad. Rama `fix/seguridad-auditoria`.
Entrega: `single-pr`. Pruebas: Vitest (unitarias) y Playwright (E2E).

## Specs

- S1 (Alta) El guard de `/admin` se salta con la ruta codificada (`/%61dmin/...`): sin sesión,
  `POST /%61dmin/assessments/<uuid>/invitaciones?/copiar` devuelve la contraseña de acceso.
  Criterio: toda ruta que SvelteKit resuelva bajo `/admin` exige sesión, sin importar la
  codificación de la URL. Test E2E de regresión con `/%61dmin`.
- S2 (Media) Importación Excel sin límite descomprimido (bomba ZIP). Criterio: se rechaza un
  .xlsx cuyo contenido descomprimido real supere el límite, antes de pasarlo a ExcelJS.
- S3 (Media) Fuerza bruta sobre la contraseña compartida rotando emails/IPs. Criterio: mínimo
  de 12 caracteres para contraseñas de acceso nuevas (las existentes siguen funcionando).
- S4 (Baja) Bloqueo de un participante ajeno con 5 intentos usando su email. Criterio: en el
  ingreso de participantes el límite por email se cuenta por (email, IP). En el login de admin
  se mantiene por email (protección de la cuenta antes que disponibilidad).
- S5 (Baja) Rate limit global detrás de un proxy sin `ADDRESS_HEADER`. Criterio: aviso al
  iniciar en producción si falta `ADDRESS_HEADER`.
- S6 (Baja) Enlaces inyectados por el nombre en modo abierto. Criterio: el nombre que escribe
  el participante no acepta URLs ni saltos de línea.
- S7 (Baja) Clave de cifrado junto a la base. Criterio: aviso en producción si se usa el
  archivo `clave-cifrado.key` en vez de `ACCESS_PASSWORD_KEY`.
- S8 (Info) El logo público de un assessment en borrador se sirve. Criterio: 404 si es borrador.
- S9 (Mantenimiento) `npm run lint` falla por la carpeta `.atl/` (herramienta local).
  Criterio: `.atl` en `.prettierignore`.

## Tasks

- [x] T1 S1 inline — guard por ruta resuelta + test E2E (ee53953; RED 404 → GREEN 303)
- [x] T2 S2 inline — límite descomprimido en .xlsx + tests (088ab2b, corregido en c04a4d7)
- [x] T3 S3,S4 inline — contraseña mínima 12 y clave por (email, IP) + tests (f4bab67)
- [x] T4 S5,S7 inline — avisos de producción (2bb5185)
- [x] T5 S6 inline — validación del nombre + test (f4bab67)
- [x] T6 S8 inline — logo de borrador 404 (1bea1bb; sin test automático, cambio de una línea)
- [x] T7 S9 inline — `.prettierignore` (1bea1bb)
- [x] T8 — verificación independiente: S1, S3–S9 cumplidos; S2 tenía un bypass, corregido

## Log

- L1 (usuario): "puedes levantar este proyecto y revisar que todo este funcionando bien correr los comando y todo y ve si tiene seguridad"
- L2 (usuario): "has la solucion como una lista de checks y solucionalos"
- L3 S1 reproducido contra el servidor de desarrollo: la respuesta incluye `demo-acceso-2026`.
- L4 Verificador: el chequeo por streaming de S2 se esquivaba poniendo en 0 el tamaño del
  encabezado local (ExcelJS/JSZip usa el directorio central). Corrección: descomprimir con
  `unzipSync` (directorio central, buffer de tamaño declarado → trunca) y pasar a ExcelJS una
  copia reempaquetada. Test con el archivo del verificador: RED → GREEN.
- L5 Cierre: 171 unitarias y 33 E2E pasan; lint y tipos limpios; el ataque de S1 ahora
  redirige al login.
