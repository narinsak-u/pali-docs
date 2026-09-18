# Agent Guidelines for next-pali-docs

## Project Overview

Next.js 15 documentation site for Pali language learning (App Router, TypeScript, Tailwind CSS v4, Fumadocs). Features AI-powered chat, quizzes, Algolia + Pinecone search, Radix UI / shadcn components, Zod validation, Lucide icons. Testing via Vitest v4 with jsdom + @testing-library/react.

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server with Turbopack |
| `bun run build` | Build for production (runs `next build` then updates index) |
| `bun run start` | Start production server |
| `bun test` | Run all tests in watch mode |
| `bun run test:run` | Run all tests once |
| `bun run index` | Run the search index update script |
| `bun run postinstall` | Run the Fumadocs generation script |
**Single test:** `bunx vitest run tests/get-stats.test.ts`

**Type checking:** Run `next build` (no ESLint, Prettier, or standalone type-check script is configured).

## Vitest Configuration

- **Config:** `vitest.config.ts` — jsdom environment, globals enabled (no import needed for `describe`/`it`/`expect`), `@vitejs/plugin-react`, `@/` alias maps to project root
- **Setup:** `vitest.setup.ts` imports `@testing-library/jest-dom/vitest`
- **Location:** All tests in `tests/` directory (e.g., `tests/get-stats.test.ts`)
- **Pattern:** `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
- Currently only helpers are tested. For component tests, use `@testing-library/react` (`render`, `screen`, `fireEvent`).

## TypeScript Configuration

- Strict mode (`"strict": true`), `bundler` module resolution, `ESNext` target, `jsx: "preserve"`
- Use `@/` path alias (maps to `./*`), `@/.source` for content files (maps to `.source/index.ts`)

## Code Style

### Imports
- Use double quotes consistently (singe quotes only appear in test files)
- Group imports: external libraries → internal `@/` → relative `./`
- Use `type` keyword for type-only imports: `import { type VariantProps }`, `import type { Question }`
- Merge type+value imports on one line: `import { clsx, type ClassValue }`
- No barrel exports except in specific cases (e.g., `components/ai/index.tsx`)

### Components
- Server components by default (no `"use client"` unless needed for hooks/browser APIs)
- Client components: first line `"use client"` (no semicolon)
- UI primitives use named exports: `export { Button, buttonVariants }`
- Pages use `export default function PageName()`
- State/presentational components use either named or default (follow file's pattern)
- Use `cva` for variant styles (see `components/ui/button.tsx`)
- Use `cn()` from `@/lib/utils` for className merging
- Use Radix UI for accessible component primitives
- Use `data-slot` attribute on Radix primitives
- For Radix components, extend via `React.ComponentProps<typeof Primitive.Root>`

### Naming
- PascalCase for components and types: `QuizTimer`, `SearchResult`
- camelCase for functions and variables: `getStats`, `userMessage`
- UPPER_SNAKE for constants: `MAX_RETRIES`, `API_BASE_URL`
- File naming: `page.tsx` (pages), `route.ts` (API routes), `*Client.tsx` or `*.client.tsx` (client sub-components)

### Hooks
- All custom hooks require `"use client"`
- Prefer `export function useHookName()` over arrow functions
- Define return type via explicit `interface` (e.g., `UseQuizFlowReturn`)
- Wrap state setters in `useCallback`, derived state in `useMemo`
- Hook composition pattern: orchestrator combines sub-hooks (see `hooks/use-quiz.ts`)
- Sub-hooks live in `lib/hooks/` (domain-specific) or `hooks/` (top-level app hooks)

### Server Actions
- Located in `actions/` directory
- Receive `unknown` input, validate with Zod schema
- Use `try/catch` with `error: unknown`; throw for quota errors, return `{ error }` objects
- Call from API routes (not directly from client components)
- `maxDuration` exported at module level

### Styling
- Tailwind CSS v4 with `@import "tailwindcss"` (not `@tailwind` directives)
- Use semantic color tokens: `bg-primary`, `text-muted-foreground`, `border-border`
- Use `cn()` for class merging, `cva` for component variants
- Avoid arbitrary values; use design tokens from `@theme inline` in `global.css`
- Inline styles only for dynamic values (e.g., CSS gradients)

### Error Handling
- `try/catch` with `error: unknown`, then `error instanceof Error` for type narrowing
- Log with `console.error("context:", error)`
- API routes return proper error responses via `NextResponse.json`
- Component-level errors handled via `react-error-boundary`
- Quota errors detected via `isQuotaError()` helper pattern
- No custom Error classes used

### API Routes
- Edge Runtime for AI/quiz routes: `export const runtime = "edge"`
- Parse body with `await req.json()`, return streaming with `result.toUIMessageStreamResponse()`
- Server runtime for search/static routes

### LLM/AI Integration
- Use `@ai-sdk/react` (`useChat`, `useObject`) and `ai` (`streamText`)
- Define tool schemas with Zod
- Use `convertToModelMessages` for message formatting, support OpenAI-compatible providers

## File Organization

```
app/                    # Next.js App Router pages
  (home)/              # Route group (home, quiz, blog, question)
  api/                 # API routes (edge/server runtime)
  docs/                # Documentation pages
components/
  ui/                  # Reusable UI primitives (Button, Card, etc.)
  ai/                  # AI/chat components
  search/              # Search-related components
lib/                   # Utilities, services, hooks, schemas
  services/            # Business logic (search, quiz, RAG pipelines)
  schemas/             # Zod schemas
  chat/                # Chat-related utilities
  hooks/               # Domain-specific hooks (quiz sub-hooks)
  contexts/            # React contexts
hooks/                 # Top-level app hooks (use-quiz orchestrator, use-ai-chat)
helpers/               # Pure functions (tests in tests/)
actions/               # Server actions
data/                  # Static data files (nav, quiz topics, content tree)
tests/                 # Test files (Vitest)
providers/             # Root-level providers (theme, Fumadocs)
```

## Content

- MDX content in `content/docs/` and `content/blog/`, configured in `source.config.ts` (Fumadocs collections)
- Access via `@/.source` alias
- LLM-friendly text export at `/llms-full.txt` and `/llms.mdx/[[...slug]]`

## Design System

Follow `DESIGN.md` for all new component creation. Quick reference:

| Category | Usage |
|----------|-------|
| Colors | Use semantic tokens (`primary`, `secondary`, `muted`) — never hardcode hex |
| Typography | Geist (English), Thasadith 600 (Thai), IBM Plex Sans Thai (blog), Geist Mono (code) |
| Spacing | 4px base: xs=4, sm=8, md=16, lg=24, xl=32, 2xl=48 |
| Radius | Buttons: `rounded-md` (8px), Cards: `rounded-xl` (12px) |
| Shadows | `shadow` for cards, `shadow-md` for elevated surfaces |

Component checklist: use `cva`, semantic colors, correct radius, `cn()`, `data-slot` for Radix, light+dark mode, focus-visible states.

## Environment Variables

Required for search and AI features:
- `ALGOLIA_APP_ID`, `ALGOLIA_API_KEY`, `ALGOLIA_INDEX_NAME`
- `OPENAI_API_KEY` (or compatible LLM provider)
- `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`

## Custom Skills

Project-specific skills in `.agents/skills/`:

- **fumadocs-content** - MDX content management, frontmatter, source config
- **quiz-engine** - Quiz state management, timer, pagination, results
- **search-indexing** - Algolia/Pinecone indexing pipeline, search API

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context domain documentation uses root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Stacked work

For large, multi-part jobs, create the stack before editing and use `gh stack add <branch>` for each dependent review layer. Keep one concern per layer; follow `skill://gh-stack` for stack setup and synchronization.

### Commit messages

Use `<emoji> <type>(<task>/<domain>): <message>` for every commit. Example: `✨ feat(quiz/flow): add timer state`. Keep the message imperative and focused.
