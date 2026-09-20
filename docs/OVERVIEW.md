# Pali Docs Overview

Pali Docs is a Next.js 15 App Router site for learning and researching Pali grammar. The site combines structured Thai/English MDX lessons with documentation search, an AI question-answering experience, and AI-generated quizzes.

## Application shape

The application is organized around five user-facing surfaces:

| Surface | Route | Responsibility |
| --- | --- | --- |
| Landing page | `/` | Introduces the learning experience and links into the curriculum, quiz, and chat. |
| Documentation | `/docs/[...]` | Renders the Pali grammar curriculum from MDX through Fumadocs. |
| Blog | `/blog/[slug]` | Renders blog posts from the separate blog MDX collection. |
| Quiz | `/quiz` | Generates and presents timed multiple-choice quizzes with pagination, scoring, and answer review. |
| Question chat | `/question` | Streams grounded answers to Pali questions. |

The shared root layout (`app/layout.tsx`) loads the multilingual fonts, global styles, metadata, and `Fumadocs` provider. Home and documentation layouts are separate: `app/(home)/layout.tsx` owns the public navigation, while `app/docs/layout.tsx` builds the documentation sidebar from the loaded page tree.

## Content pipeline

Documentation content lives in `content/docs/` and is grouped into four curriculum parts:

1. `part-1` — อักขรวิธี
2. `part-2` — วจีวิภาค
3. `part-3` — วากยสัมพันธ์
4. `part-4` — ฉันทลักษณะ

Blog content lives in `content/blog/`. `source.config.ts` defines the Fumadocs documentation and blog collections, including blog frontmatter validation. `lib/source.ts` adapts both collections to Fumadocs loaders:

- Documentation pages use `/docs` as their base URL.
- Blog posts use `/blog` as their base URL.
- `source.pageTree` drives the documentation sidebar.
- Cached page lookups support page rendering and generated text exports.

The content tree used by the landing page and navigation is represented separately in `data/contentData.ts` and `data/mainMenuData.tsx`. Keep those navigation structures aligned with the MDX curriculum when adding or moving sections.

## AI question flow

The question page uses `hooks/use-ai-chat.ts` and the AI components in `components/ai/`. Messages are sent to `POST /api/question` through the AI SDK transport.

The server-side flow is:

1. `app/api/question/route.ts` receives UI messages.
2. The selected LLM can call `searchDocs`.
3. `lib/services/rag-pipeline.ts` embeds the query and queries Pinecone through `lib/services/vector-store.ts`.
4. `lib/services/embedding.ts` uses Pinecone inference with a bounded LRU cache.
5. Retrieved passages are formatted and injected into the next model step.
6. The response streams answer text and UI data for task status, reasoning, and follow-up suggestions.

`lib/services/llm-provider.ts` selects OpenRouter by default or OpenCode when `PROVIDER_NAME=opencode`. Provider-specific model and API-key settings are environment-driven. The detailed sequence, streaming events, and error behavior are documented in [`RAG-WORKFLOW.md`](./RAG-WORKFLOW.md).

## AI quiz flow

Quiz state is orchestrated by `hooks/use-quiz.ts`, which composes the domain hooks under `lib/hooks/` for flow, data, UI, AI streaming, and statistics. The visible states are `home`, `loading`, `quiz`, and `results`.

The server-side flow is:

1. A user selects a topic from `data/quiz-topic.tsx`.
2. The client posts the quiz request to `POST /api/quiz`.
3. `lib/services/quiz-pipeline.ts` loads topic context from `data/quiz-content.json`.
4. The configured LLM generates JSON questions in one call.
5. The response is parsed and validated with the Zod schemas in `lib/schemas/quiz.ts`.
6. Questions stream to the client, where they are mapped, shuffled, timed, paginated, scored, and reviewed.

Quiz generation does not query Pinecone. The curated JSON content keeps the quiz path independent of the RAG index. See [`QUIZ-WORKFLOW.md`](./QUIZ-WORKFLOW.md) for the complete state and streaming flow.

## Search and text exports

Fumadocs exposes documentation records through `GET /static.json`. Each page contributes a page-level record and records for its headings. `GET /api/search` provides the runtime search handler from the same loaded source.

The build and indexing path is:

```text
MDX content → Fumadocs source → /static.json → .next/server/app/static.json.body → Algolia index
```

Run `bun run index` to configure the `docs` Algolia index for English and Thai and synchronize the generated records. The script reads the build output when available and otherwise falls back to `http://localhost:3000/static.json`.

LLM-friendly exports are available at:

- `/llms-full.txt` for the full documentation corpus.
- `/llms.mdx/[...]` for an individual documentation page.

## Repository map

| Path | Role |
| --- | --- |
| `app/` | App Router pages, layouts, route handlers, and text-export endpoints. |
| `content/docs/` | Pali grammar MDX curriculum. |
| `content/blog/` | Blog MDX content. |
| `components/ui/` | Reusable Radix/shadcn-style UI primitives. |
| `components/ai/` | Chat, streaming status, reasoning, and quiz-generation UI. |
| `hooks/` | Top-level client orchestrators such as `use-ai-chat` and `use-quiz`. |
| `lib/services/` | LLM, RAG, embeddings, Pinecone, quiz, and search services. |
| `lib/schemas/` | Zod request and response schemas. |
| `lib/hooks/` | Quiz-specific state sub-hooks. |
| `helpers/` | Pure transformations and statistics helpers. |
| `data/` | Navigation data, quiz topics, and curated quiz context. |
| `scripts/update-index.mjs` | Algolia index configuration and synchronization. |
| `tests/` | Vitest unit and route tests. |
| `docs/` | Contributor workflow and architecture notes. |

## Local development and verification

The repository uses Bun scripts defined in `package.json`:

```bash
bun install
bun run dev       # Next.js development server with Turbopack
bun run test:run  # Vitest once
bun run build     # Production build, then Algolia index update
bun run start     # Serve the production build
bun run index     # Synchronize the Algolia index
```

`bun run build` invokes `next build` and then `scripts/update-index.mjs`. A successful build therefore also requires the Algolia indexing environment to be available. The GitHub Actions workflow runs `bun install --frozen-lockfile` and `bun run test:run` for pushes and pull requests targeting `main`.

Before exercising AI features locally, copy `.env.example` to `.env.local` and configure the relevant provider, Pinecone, and Algolia variables. The application supports:

- Pinecone: `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, optional `PINECONE_NAMESPACE`.
- LLM provider: `PROVIDER_NAME`, provider API key, and optional model name.
- Algolia: public app/search settings plus the server-only `ALGOLIA_ADMIN_API_KEY` used by the index script.

## Implementation conventions

- Prefer server components; add `"use client"` only for hooks or browser APIs.
- Use the `@/` path alias and double-quoted imports in application code.
- Validate route payloads with Zod and return explicit HTTP errors from handlers.
- Use semantic Tailwind tokens and `cn()` for class composition; follow `DESIGN.md` for new UI.
- Keep business logic in `lib/services/`, state composition in hooks, and route handlers thin.
- Preserve Thai language metadata and typography when changing documentation or navigation surfaces.
