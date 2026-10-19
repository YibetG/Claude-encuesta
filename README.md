# Plataforma de Assessments

Encuestas evaluativas con acceso por contraseña compartida, reportes por pregunta,
exportación a Excel/PDF y análisis con IA de las respuestas abiertas.

Stack: SvelteKit 3 (Svelte 5) · TypeScript · Tailwind CSS 4 · SQLite (better-sqlite3 + Drizzle) · Zod.

> Este README se completa en la fase final (respaldo de la base, despliegue, etc.).

## Requisitos

- Node.js 22 LTS o superior
- Git

## Instalación

```bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
npm run db:migrate          # crea data/app.db con todas las tablas
npm run create-admin        # crea el primer administrador (pide email, nombre y contraseña)
npm run dev                 # http://localhost:5173  → "Ingreso de administradores"
```

### Administradores

```bash
npm run create-admin                                   # crear (interactivo)
npm run create-admin -- --reset --email ana@empresa.com  # cambiar contraseña (cierra sus sesiones)
```

- Contraseñas con hash Argon2id; mínimo 10 caracteres.
- Tras 5 intentos fallidos con un mismo email (o 20 desde una misma IP) el ingreso
  se bloquea 15 minutos.
- Las cookies de sesión son `HttpOnly`, `Secure` y `SameSite=Lax`. En producción la
  app **debe** servirse por HTTPS (en `localhost` el navegador las acepta igual).
- Si la app queda detrás de un proxy (Nginx, etc.), defina `ADDRESS_HEADER=X-Forwarded-For`
  y `XFF_DEPTH` para que el bloqueo por IP use la IP real del visitante.

## Comandos

| Comando                    | Qué hace                                                        |
| -------------------------- | --------------------------------------------------------------- |
| `npm run dev`              | Servidor de desarrollo                                          |
| `npm run build`            | Compila para producción (adapter-node, carpeta `build/`)        |
| `npm run check`            | Verificación de tipos                                           |
| `npm run lint`             | Prettier + ESLint                                               |
| `npm run test:unit`        | Pruebas unitarias (Vitest)                                      |
| `npm run test:e2e`         | Pruebas de punta a punta (Playwright, usa `data/e2e.db`)        |
| `npm run test:e2e:install` | Descarga el navegador de Playwright (solo la primera vez)       |
| `npm run db:generate`      | Genera una migración tras cambiar `src/lib/server/db/schema.ts` |
| `npm run db:migrate`       | Aplica las migraciones pendientes                               |
| `npm run create-admin`     | Crea un administrador o cambia su contraseña (`--reset`)        |

## Variables de entorno

Ver [`.env.example`](.env.example): cada variable está documentada allí.
