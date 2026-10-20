# Plataforma de Assessments

Encuestas evaluativas con acceso por contraseña compartida, reportes de alineación por
pregunta, exportación a Excel y PDF, y análisis con IA de las respuestas abiertas.

**Stack:** SvelteKit 3 (Svelte 5) · TypeScript estricto · Tailwind CSS 4 · SQLite
(better-sqlite3 + Drizzle ORM) · Zod · ExcelJS · pdfmake · Nodemailer · Anthropic SDK.

## Qué hace

| Para quién        | Funciones                                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Administrador** | Crear, editar, duplicar y archivar assessments · editor de preguntas (selección única y abiertas) e importación desde Excel/CSV · contraseña de acceso compartida · participantes (manual o Excel/CSV) · invitaciones por correo · reportes · exportación · análisis con IA · auditoría |
| **Participante**  | Abre el enlace, escribe la contraseña de acceso y su correo, responde con autoguardado (puede salir y volver) y entrega una sola vez                                                                                                                                                    |

En los reportes no hay puntaje por persona: cada pregunta de selección tiene una opción
**esperada** y se mide la **alineación** (porcentaje de quienes respondieron que eligió esa
opción). Solo cuentan las entregas finales.

## Requisitos

- Node.js 22 LTS o superior (probado con Node 24)
- Git

## Instalación y primer uso

```bash
npm install
cp .env.example .env          # en Windows (PowerShell): copy .env.example .env
npm run db:migrate            # crea data/app.db con todas las tablas
npm run create-admin          # crea el primer administrador (pide email, nombre y contraseña)
npm run db:seed               # opcional: datos de ejemplo
npm run dev                   # http://localhost:5173 → "Ingreso de administradores"
```

### Datos de ejemplo

`npm run db:seed` crea un assessment publicado, **"Assessment de ejemplo: Seguridad de la
información"**, con 10 preguntas (8 de selección y 2 abiertas), 14 participantes de varias
áreas y respuestas simuladas (10 entregas, 2 en progreso y 2 pendientes). Sirve para probar
los reportes, las exportaciones y el análisis con IA.

- Contraseña de acceso de prueba: `demo-acceso-2026` (solo para estos datos de ejemplo).
- Los participantes usan correos `@ejemplo.test`. Para responder como uno de los pendientes,
  use `camila.vargas@ejemplo.test`.
- `npm run db:seed -- --reset` borra el assessment de ejemplo y lo vuelve a crear.

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). Las principales:

| Variable                                                                            | Para qué                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | Ruta del archivo SQLite (por defecto `data/app.db`)                                       |
| `APP_URL`                                                                           | URL pública; se usa para armar los enlaces de invitación                                  |
| `ADMIN_SESSION_HOURS` / `PARTICIPANT_SESSION_HOURS`                                 | Duración de las sesiones (se renuevan con el uso; la de admin vence siempre a los 7 días) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `AI_TIMEOUT_MS`                           | Análisis con IA (modelo por defecto `claude-opus-5-5`)                                    |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Envío de invitaciones. Sin `SMTP_HOST`, los correos se imprimen en la consola             |
| `ORIGIN`, `BODY_SIZE_LIMIT`, `ADDRESS_HEADER`, `XFF_DEPTH`                          | Solo en producción (ver [Despliegue](#despliegue-en-producción))                          |

Los secretos van solo en `.env`, que nunca se sube al repositorio.

## Comandos

| Comando                    | Qué hace                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`              | Servidor de desarrollo                                                    |
| `npm run build`            | Compila para producción (adapter-node, carpeta `build/`)                  |
| `npm run check`            | Verificación de tipos                                                     |
| `npm run lint`             | Prettier + ESLint                                                         |
| `npm run test:unit`        | Pruebas unitarias (Vitest)                                                |
| `npm run test:e2e`         | Pruebas de punta a punta (Playwright; usa una base aparte, `data/e2e.db`) |
| `npm run test:e2e:install` | Descarga el navegador de Playwright (solo la primera vez)                 |
| `npm test`                 | Unitarias + E2E                                                           |
| `npm run db:migrate`       | Aplica las migraciones pendientes                                         |
| `npm run db:generate`      | Genera una migración tras cambiar `src/lib/server/db/schema.ts`           |
| `npm run db:seed`          | Datos de ejemplo (`-- --reset` para recrearlos)                           |
| `npm run db:backup`        | Respaldo en caliente de la base (ver abajo)                               |
| `npm run create-admin`     | Crea un administrador o cambia su contraseña (`-- --reset --email …`)     |

## Cómo se usa

1. **Crear el assessment:** título, descripción, instrucciones, fechas con zona horaria
   (por defecto America/Bogota), modo de acceso (solo invitados o abierto) y límite de
   caracteres de las respuestas abiertas (8.000 por defecto, unas dos páginas).
2. **Preguntas:** en el editor, desde un **documento Word** o con la plantilla de Excel.
   En Word: cada pregunta numerada (`1.`, `2.` o lista automática), sus opciones debajo con
   letras o viñetas, y la respuesta correcta **subrayada o resaltada** (o con `(correcta)`
   al final). Una pregunta sin opciones es abierta; `(opcional)` al final la deja no
   obligatoria. Las preguntas leídas se cargan en el editor con avisos de lo que hay que
   revisar, y solo se guardan al pulsar **Guardar preguntas**. Hay plantilla Word descargable.
   Cuando alguien empieza a responder, las preguntas quedan bloqueadas; para cambiarlas,
   duplique el assessment.
3. **Contraseña de acceso, logo del cliente y publicación** (pestaña General). La
   contraseña se puede generar al azar, ver mientras se escribe y volver a mostrar después.
   El logo aparece al participante y en la portada del PDF (en el PDF solo PNG o JPG).
   **Colores del cliente:** un color principal (franja superior) y uno de acento (botones,
   progreso, selección) reemplazan los de la plataforma en las pantallas del participante y
   en el PDF. Se recomiendan tonos oscuros (texto blanco con contraste ≥ 4,5:1); un tono más claro
   se permite, con advertencia y vista previa.
4. **Participantes:** manual o con la plantilla de Excel/CSV (nombre, email, área, cargo y
   columnas adicionales).
5. **Invitaciones:** plantilla editable con variables (`{{nombre}}`, `{{enlace}}`,
   `{{contrasena}}`, `{{inicio}}`, `{{fin}}`…), envío por correo o mensaje para copiar.
   La contraseña vigente se incluye automáticamente.
6. **Reportes:** resumen, alineación por pregunta con gráficos, respuestas abiertas, tabla
   por participante, filtros por área y cargo, análisis con IA y descargas en Excel y PDF.

## Correo

- Sin `SMTP_HOST` los correos **no se envían**: se imprimen en la consola del servidor.
- Para probar con un buzón local use [Mailpit](https://mailpit.axllent.org)
  (`SMTP_HOST=localhost`, `SMTP_PORT=1025`) y abra http://localhost:8025.

## Análisis con IA (Anthropic)

- Configure `ANTHROPIC_API_KEY` en `.env`. La key solo se usa en el servidor.
- Cada pregunta abierta tiene **Analizar con IA**, y además hay un análisis global. Se
  analizan las entregas finales, sin aplicar filtros.
- Antes de enviar se quitan nombres, correos y teléfonos: se envía solo el texto de las
  respuestas. Los nombres de terceros que no son participantes pueden seguir en el texto.
- Si el texto es mucho, se procesa en bloques y luego se consolida. El resultado se guarda
  con fecha y modelo; si las respuestas no cambiaron, no se vuelve a llamar a la IA.
  **Regenerar** fuerza una llamada nueva. Cada análisis tiene un costo según el uso.
- Está activado el respaldo automático del servidor (`fallbacks: "default"`): si el modelo
  declina una solicitud, Anthropic la reintenta con otro modelo adecuado.

## Respaldo de la base de datos

Toda la información está en un solo archivo SQLite (`DATABASE_URL`).

```bash
npm run db:backup                          # crea backups/app-AAAAMMDD-HHMMSS.db (hora UTC)
npm run db:backup -- --dir D:\respaldos     # en otra carpeta
npm run db:backup -- --keep 14             # conserva solo los 14 respaldos más recientes
```

- Es un respaldo **en caliente**: usa la API de backup de SQLite, así que es consistente
  aunque la app esté en uso. No copie `app.db` a mano mientras la app corre: la base usa
  modo WAL y quedaría incompleta.
- Prográmelo a diario (Programador de tareas de Windows o `cron`) y guarde copias fuera
  del servidor.
- **Restaurar:** detenga la app, reemplace el archivo de `DATABASE_URL` por el respaldo,
  borre los archivos `-wal` y `-shm` que estén al lado, y vuelva a iniciar.
- **Respalde también la clave de cifrado** (`data/clave-cifrado.key`, o anote
  `ACCESS_PASSWORD_KEY`). Sin ella las contraseñas de acceso no se pueden mostrar (el
  ingreso de los participantes sigue funcionando, porque usa el hash).

## Despliegue en producción

```bash
npm ci
npm run build
npm run db:migrate
node --env-file=.env build      # escucha en el puerto 3000 (variables PORT y HOST)
```

- **HTTPS es obligatorio:** las cookies de sesión son `Secure` y el navegador las descarta
  por HTTP (salvo en `localhost`). Ponga la app detrás de un proxy inverso con TLS.
- Defina `ORIGIN` con la URL pública (la verificación CSRF la necesita) y `APP_URL` con la
  misma URL.
- Detrás de un proxy, defina `ADDRESS_HEADER` y `XFF_DEPTH` para registrar y limitar por la
  IP real del visitante.
- Para subir logos y archivos de importación (Word hasta 10 MB), defina `BODY_SIZE_LIMIT=11M`.
- La app corre en **un solo proceso** (SQLite + candados en memoria): no levante varias
  instancias contra la misma base.

## Seguridad

- **Contraseñas:** Argon2id para los administradores. La contraseña compartida de cada
  assessment se valida con su hash Argon2id y, además, se guarda **cifrada** (AES-256-GCM)
  para que el admin pueda verla y no tenga que escribirla al invitar. La clave de cifrado
  está fuera de la base (`ACCESS_PASSWORD_KEY` o el archivo `clave-cifrado.key`), y cada vez
  que alguien muestra una contraseña queda registrado en la auditoría.
- **Logos:** solo PNG, JPG o WebP de hasta 2 MB, validados por su contenido (no por la
  extensión). SVG no se acepta porque puede contener código.
- **Sesiones** en la base (solo se guarda el hash del token), cookies `HttpOnly`, `Secure`,
  `SameSite=Lax`, con vencimiento por inactividad. La de admin tiene además un tope de 7
  días; la de participante solo sirve para su assessment.
- **CSRF:** la verificación de origen de SvelteKit está activa en todos los formularios.
- **Validación con Zod** en el servidor, consultas solo con el ORM, y todo el contenido de
  usuarios se muestra escapado (sin `{@html}`). En Excel se neutralizan las fórmulas.
- **Rate limiting** con bloqueo de 15 minutos: admin (5 fallos por email, 20 por IP) y acceso
  de participantes (5 por email, 50 por IP). Los intentos se procesan de a uno por clave,
  así que las ráfagas simultáneas no esquivan el límite.
- **Encabezados:** CSP con nonces, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `X-Content-Type-Options`, `Permissions-Policy`, COOP/CORP y HSTS (sobre HTTPS).
- **Participantes:** en cada petición se verifica la sesión, que no haya entregado y que el
  assessment esté publicado y dentro de las fechas. La opción esperada nunca se envía a su
  navegador.
- **Auditoría** de ingresos, creación y edición, preguntas, contraseña de acceso,
  participantes, invitaciones, exportaciones y análisis con IA (pestaña Auditoría).
- **Mantenimiento automático:** cada hora se borran las sesiones vencidas y los registros de
  intentos antiguos.

### Limitaciones conocidas (por diseño)

- **Contraseña compartida + email no prueba identidad.** Quien conozca la contraseña y el
  correo de un colega invitado podría responder por él. Si esto es un riesgo para su caso,
  la mejora recomendada es un enlace individual por persona o un código enviado al correo.
- **Bloqueo por intentos:** cinco intentos fallidos con un email lo bloquean 15 minutos,
  aunque los haga otra persona. Es el comportamiento pedido (bloqueo por email y por IP).
- **Análisis con IA:** un participante puede escribir texto pensado para sesgar el análisis.
  Las respuestas se envían como datos delimitados y la salida se muestra como texto, pero
  conviene leer el análisis junto con las respuestas originales.

## Estructura del proyecto

```
src/
  hooks.server.ts            sesiones de admin, protección de /admin, encabezados, mantenimiento
  env.ts                     variables de entorno (validadas al iniciar)
  lib/
    schemas/                 validaciones Zod (admin, assessment, preguntas, participantes, acceso)
    components/              componentes de interfaz (formularios, gráficos, panel de IA…)
    server/
      db/                    esquema Drizzle y conexión
      auth/                  contraseñas, sesiones, cookies
      security/              rate limiting, auditoría, encabezados
      services/              lógica: assessments, preguntas, participantes, acceso, respuestas,
                             invitaciones, reportes, análisis con IA
      import/  export/       Excel/CSV de entrada; Excel y PDF de salida
      email/   ai/           correo (SMTP/consola) y cliente de Anthropic
  routes/
    admin/                   panel de administración
    a/[slug]/                ingreso, respuesta y confirmación del participante
scripts/                     migrate, create-admin, seed, backup, e2e-setup
drizzle/                     migraciones SQL
tests/e2e/                   pruebas Playwright
```

## Pruebas

- **Unitarias (Vitest):** validaciones, sesiones, rate limiting, acceso por fechas y entrega
  única, cálculo de reportes, importación y exportación, anonimización y análisis con IA
  (con un cliente simulado, sin llamadas reales).
- **E2E (Playwright):** login y bloqueo, CSRF, editor e importación de preguntas,
  participantes e invitaciones, flujo del participante y el flujo completo: invitar →
  ingresar → responder → reportar → exportar.

```bash
npm run test:e2e:install   # solo la primera vez
npm test
```
