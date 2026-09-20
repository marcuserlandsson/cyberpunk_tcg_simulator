# Repository Guidelines

## Project Structure & Module Organization

- `src/engine/` contains the pure TypeScript rules engine; `src/cards/` holds effect primitives and scripted card behavior.
- `src/ai/` implements opponents; `src/sim/` runs batches and browser workers.
- `src/ui/` contains React components and styles; `src/server/` provides collection persistence; `src/collection/` holds shared collection formats.
- `data/` stores card catalogs, printings, artwork identities, and decks. Downloaded art belongs in gitignored `data/images/`.
- `tests/` groups unit/integration tests by subsystem; `e2e/` contains browser specs. `scripts/` provides simulation and data utilities; `docs/` records rules and design decisions.

## Build, Test, and Development Commands

Use Node.js 24, the documented development version, and install dependencies with `npm ci`.

- `npm run dev`: start the Vite development server.
- `npm run build`: type-check and generate production assets in `dist/`.
- `npm run preview`: serve the production build with collection persistence.
- `npm test`: run the Vitest suite; `npm run test:watch` enables watch mode.
- `npx playwright install chromium`: install the browser required for E2E tests.
- `npm run e2e`: run Playwright against its dedicated local server.
- `npm run sim -- --games 100 --seed 7`: run a reproducible AI simulation.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, and generally omit statement-ending semicolons; match surrounding code. Use PascalCase for React components and types, camelCase for functions and variables, and `useX` for hooks. No dedicated formatter or linter is configured; the build checks types.

Keep the engine independent of UI code. Derive UI and AI moves from `legalActions`; apply them through `applyAction`. Consult `docs/current-rules.md` before changing rule interpretations.

## Testing Guidelines

Use `*.test.ts`/`*.test.tsx` under `tests/` and `*.spec.ts` under `e2e/`. UI tests use Testing Library and a `// @vitest-environment jsdom` pragma. Add deterministic regression cases for behavior changes; no numeric coverage threshold is configured. Run focused tests while developing, then `npm test` and `npm run build`; run E2E tests for browser workflows.

Preserve Playwright's scratch collection configuration: normal collection saves can trigger Git commits and pushes.

## Commit & Pull Request Guidelines

History mixes imperative summaries with `feat(scope):`, `fix(scope):`, and `docs:` prefixes. Prefer concise, scoped commits. PRs should explain behavior changes, link relevant issues, report validation, and include screenshots for visual changes. Update rules documentation when interpretations change.
