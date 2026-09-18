# GEMINI.md - Project Context & Guidelines

## 📖 Project Overview

**next-pali-docs** is a modern documentation platform for Pali language learning. It transforms traditional Pali grammar textbooks into a searchable, interactive, and AI-enhanced digital experience.

- **Primary Goal:** Make ancient Pali wisdom accessible through modern technology.
- **Key Features:**
  - Full Pali grammar curriculum (Akkhara-vidhi, Vaci-vibhaga, Vakyasampandha, Chandalakkhana).
  - Lightning-fast search powered by Algolia.
  - AI-powered chat for answering student queries.
  - Interactive quiz system for self-testing.
  - Modern, responsive UI built with Next.js 15 and Tailwind CSS v4.

## 🛠 Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (Strict Mode)
- **Content Engine:** [Fumadocs](https://fumadocs.vercel.app/) (MDX-based)
- **Styling:** Tailwind CSS v4, `class-variance-authority` (CVA), `tailwind-merge`
- **UI Components:** Radix UI Primitives, Lucide Icons
- **Search:** Algolia (Text Search) + Pinecone (Vector Search)
- **AI Integration:** Vercel AI SDK (`ai` package), OpenAI-compatible models
- **Validation:** Zod

## 📁 Project Structure

```text
app/                    # Next.js App Router
  (home)/              # Home, Blog, Quiz, and Question pages
  api/                 # API Routes (Edge Runtime for AI/Search)
  docs/                # Documentation Layout and Pages
components/
  ui/                  # Base UI components (Radix + Tailwind)
  ai/                  # AI Chat and Markdown components
  search/              # Algolia/Search UI
content/               # MDX content files (Docs and Blog)
lib/                   # Shared utilities, schemas, and AI logic
  chat/                # AI chat utilities
  schemas/             # Zod schemas (Quiz, etc.)
helpers/               # Helper functions (mapping, stats)
data/                  # Static configuration and data
actions/               # Server actions (Quiz logic)
public/                # Static assets (images, icons)
scripts/               # Maintenance scripts (e.g., search indexing)
```

## 🚀 Commands

| Command | Purpose |
| :--- | :--- |
| `bun run dev` | Starts development server with Turbopack. |
| `bun run build` | Builds for production and updates the search index. |
| `bun run start` | Runs the production server. |
| `bun run index` | Manually triggers the search index update. |
| `bun run postinstall` | Runs the Fumadocs generation script. |

*Note: Use `bun run build` for full type checking and production readiness verification.*

## 💡 Development Guidelines

### TypeScript & Paths
- **Strict Mode:** Always ensure type safety. Avoid `any`.
- **Aliases:** 
  - `@/*` -> Root directory (e.g., `@/lib/utils`)
  - `@/.source` -> Auto-generated content index (from `.source/index.ts`)

### Component Architecture
- **Server Components:** Default to Server Components. Use `"use client"` only when necessary for interactivity or browser APIs.
- **Client Logic:** For complex client-side logic, prefer `*.client.tsx` or `*Client.tsx` naming conventions.
- **Styling:** Use the `cn()` utility from `@/lib/utils` for conditional class merging.
- **Variants:** Use `cva` for component variants (see `components/ui/button.tsx`).

### AI & Chat
- The RAG chat API is in `app/api/question/route.ts`.
- Use `convertToModelMessages` for properly formatting history for the AI SDK.

### Content Management
- Documentation is managed via **Fumadocs**. 
- Content resides in `content/docs` and `content/blog`.
- `source.config.ts` defines the content structure and frontmatter schemas.
- `lib/source.ts` initializes the source adapter.
- **LLM-Friendly Routes:** The project supports LLM-friendly content access. Requests to `/docs/:path*.mdx` are rewritten to `/llms.mdx/:path*`.

### Search Implementation
- **Algolia:** Primary search for documentation.
- **Pinecone:** Used for vector-based search/RAG if enabled.
- The indexing script is located at `scripts/update-index.mjs`.

## 🎨 Design Principles
- **Modern & Clean:** Prioritize readability for study materials.
- **Accessible:** Use Radix UI primitives to ensure high accessibility.
- **Performance:** Utilize Turbopack for dev and Next.js optimization for production.

## 🤖 Interaction Policy for Agents
- When modifying MDX files, ensure frontmatter matches the schemas in `source.config.ts`.
- When adding new UI components, follow the existing pattern in `components/ui/`.
- Prioritize updating `AGENTS.md` if significant architectural changes are made.
