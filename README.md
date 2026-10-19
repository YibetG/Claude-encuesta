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
npm run dev                 # http://localhost:5173
```

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

## Variables de entorno

Ver [`.env.example`](.env.example): cada variable está documentada allí.
