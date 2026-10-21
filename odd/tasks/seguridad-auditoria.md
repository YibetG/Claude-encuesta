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

- [ ] T1 S1 inline — guard por ruta resuelta + test E2E
- [ ] T2 S2 inline — límite descomprimido en .xlsx + test unitario
- [ ] T3 S3,S4 inline — contraseña mínima 12 y clave por (email, IP) + tests
- [ ] T4 S5,S7 inline — avisos de producción
- [ ] T5 S6 inline — validación del nombre + test
- [ ] T6 S8 inline — logo de borrador 404
- [ ] T7 S9 inline — `.prettierignore`
- [ ] T8 — verificación independiente (alto riesgo: auth)

## Log

- L1 (usuario): "puedes levantar este proyecto y revisar que todo este funcionando bien correr los comando y todo y ve si tiene seguridad"
- L2 (usuario): "has la solucion como una lista de checks y solucionalos"
- L3 S1 reproducido contra el servidor de desarrollo: la respuesta incluye `demo-acceso-2026`.
