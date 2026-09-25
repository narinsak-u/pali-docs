# 📖 Pali Docs - A documentation site for Pali language

> **"การเรียนรู้ไม่ควรถูกจำกัดด้วยตำรา แต่ควรเปิดกว้างด้วยเทคโนโลยี"**

ในปัจจุบัน การเรียนรู้ภาษาบาลียังคงพึ่งพาตำราและหนังสือเรียนเป็นหลัก ซึ่งแม้จะเต็มเปี่ยมไปด้วยคุณค่าทางวิชาการที่ล้ำค่า แต่ก็มาพร้อมกับข้อจำกัดหลายประการ ไม่ว่าจะเป็นความไม่สะดวกในการพกพา การค้นหาข้อมูลเฉพาะจากเอกสารที่มีปริมาณมหาศาลซึ่งต้องใช้เวลาและความพยายามอย่างมาก แม้จะมีการแปลงเนื้อหาเป็นไฟล์ดิจิทัลอย่าง PDF แล้วก็ตาม แต่ปัญหาในการสืบค้นก็ยังคงเป็นอุปสรรคสำคัญสำหรับผู้ศึกษาจำนวนไม่น้อย

ในยุคที่เทคโนโลยีเข้ามาเปลี่ยนวิถีชีวิต การนำเสนอเนื้อหาการเรียนภาษาบาลีในรูปแบบดิจิทัล จึงเป็นคำตอบที่ทันสมัยและตอบโจทย์ความต้องการของผู้เรียนในปัจจุบัน โปรเจกต์ **"Palidocs"** จึงมีขึ้นเพื่อเป็นสะพานเชื่อมระหว่างองค์ความรู้ดั้งเดิมกับนวัตกรรมใหม่ๆ โดยมีเป้าหมายหลักในการสร้างแพลตฟอร์มการเรียนบาลีไวยากรณ์ออนไลน์ที่ใช้งานง่าย สะดวกต่อการทบทวนและสืบค้นข้อมูล เพื่อให้ผู้เรียนสามารถเข้าถึงการศึกษาได้อย่างไร้ขีดจำกัดด้านเวลาและสถานที่.

#### 📌 เนื้อหาครอบคลุมบาลีไวยากรณ์ ๔ ภาค ดังนี้:
- **อักขรวิธี** - ว่าด้วยอักษร จัดเป็น ๒ คือ สมัญญาภิธาน ๑ สนธิ ๑.
- **วจีวิภาค** - แบ่งคำพูดออกเป็น ๖ ส่วน คือ นาม ๑ อัพยยศัพท์ ๑ สมาส ๑ ตัทธิต ๑ อาขยาต ๑ กฤต ๑.
- **วากยสัมพันธ์** - ว่าด้วยการก และประพันธ์ผูกคำพูดที่แบ่งไว้ในวจีวิภาคให้เข้าเป็นประโยคอันเดียวกัน.
- **ฉันทลักษณะ** - แสดงวิธีแต่งฉันท์ คือคาถาที่เป็นวรรณพฤทธิ์และมาตราพฤทธิ์.

#### ✨ วัตถุประสงค์:

* **เรียนภาษาบาลีได้ทุกที่ทุกเวลา:** <br/>
  บอกลาหนังสือเรียนเล่มหนา! เข้าถึงบทเรียนภาษาบาลีที่ครบถ้วนได้จากทุกอุปกรณ์ ไม่ว่าจะบนมือถือระหว่างพักกลางวันหรือบนแล็ปท็อปตอนดึก ๆ
* **หลักสูตรที่สมบูรณ์และค้นหาได้ง่าย:** <br/>
  ตั้งแต่ **ไวยากรณ์** พื้นฐาน **วากยสัมพันธ์** ไปจนถึง **ฉันทลักษณ์** มีครบทุกอย่างในรูปแบบที่จัดระเบียบอย่างสวยงามและค้นหาได้ง่าย
* **ค้นหาได้เร็วปานสายฟ้าแลบ:** <br/>
  ขับเคลื่อนด้วย Algolia ค้นหาสิ่งที่คุณต้องการได้ในเสี้ยววินาที ไม่ต้องพลิกหน้ากระดาษเป็นร้อย ๆ อีกต่อไป

## The Vision

We believe learning shouldn't be limited by textbooks but should be opened up through technology. Pali Docs bridges the gap between traditional scholarship and modern innovation, making ancient wisdom accessible to everyone, everywhere.


#### 🎯 Perfect For:

- **Students** diving into Pali studies
- **Scholars** needing quick reference materials
- **Anyone curious** about this beautiful ancient language
- **Self-learners** who prefer flexible, on-demand education

#### ✨ Objective:

* **Learn Pali Anywhere, Anytime:** Access comprehensive Pali lessons from any device. Ditch the heavy textbooks and study on your phone or laptop whenever you want.
* **Complete & Searchable Curriculum:** From **grammar** to **sentence structure** and **prosody**, we've got you covered. Find exactly what you need in a beautifully organized, searchable format.
* **Lightning-Fast Search:** Find what you're looking for in milliseconds with our Algolia-powered search. No more flipping through hundreds of pages.


## 🖼️ Screenshot:

![screenshot](/public/Screenshot.png)

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `app/layout.config.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/question/route.ts` | The RAG chat API (LLM + vector search)        |
| `app/api/search/route.ts` | The Route Handler for search.                          |
| `app/api/quiz/route.ts`   | The quiz generation API (SSE streaming).               |

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## 🏗️ Project Structure

```
├── app/                    # Next.js App Router pages
│   ├── (home)/            # Landing page & route groups
│   ├── api/               # API routes (search, question, quiz)
│   │   ├── question/      # RAG-powered chat endpoint
│   │   └── search/        # Algolia search endpoint
│   └── docs/              # Documentation layout & pages
├── components/
│   ├── ui/                # Reusable UI primitives (Button, Card, etc.)
│   └── ai/                # AI chat components (AIMessage, TaskStep, etc.)
├── lib/
│   ├── services/          # Business logic (RAG pipeline, search, embeddings)
│   ├── schemas/           # Zod validation schemas
│   ├── chat/              # System prompts & chat utilities
│   └── hooks/             # Domain-specific hooks
├── hooks/                 # Top-level app hooks (useAIChat, useQuiz)
├── helpers/               # Pure utility functions
├── actions/               # Server actions
├── data/                  # Static data (nav, quiz topics, content tree)
├── providers/             # Root-level providers (theme, Fumadocs)
├── tests/                 # All Vitest test files
└── content/
    ├── docs/              # MDX documentation content
    └── blog/              # MDX blog content
```

## 🤖 AI Features

### 💬 RAG Chat — Ask Questions About Pali Grammar

Got a question about Pali grammar? The AI chat searches the textbook corpus and answers with validated references — like having a Pali scholar right beside you.

![Chat screenshot](/public/chat_screenshot.png)

The implemented flow has three explicit boundaries:

```text
POST /api/question
    │ validate a bounded raw body, preflight config, start the UI stream
    ▼
AgentTurnRunner
    │ classify the turn; answer directly or make at most two retrieval attempts
    ▼
Retriever
    │ query embedding → Pinecone candidates → validated, budgeted evidence
    ▼
AgentTurnRunner
    │ grounded draft → citation validation → at most one citation repair
    ▼
text + citations + optional suggestions + terminal outcome
```

The runner reports `answered`, `insufficient-evidence`, `retrieval-unavailable`, or `failed` explicitly. Grounded answers can cite only accepted Pinecone passages; missing or invented citation IDs are never silently accepted. The request cancellation signal is passed from the route through model and retrieval stages.

**Key components:**
- **`app/api/question/route.ts`** — HTTP validation, configuration preflight, stream construction, and cancellation handoff
- **`lib/agent/ai-sdk-runner.ts`** — retrieval decision, two-attempt loop, generation, citation repair, and outcomes
- **`lib/agent/ai-sdk-event-sink.ts`** — projection to validated AI SDK data/text parts
- **`lib/rag/retriever.ts`** — retrieval policy and safe evidence construction
- **`lib/services/vector-store.ts`** — Pinecone lookup and citation-safe metadata mapping

The application path is implemented. Production citation rollout is externally blocked until the ingestion owner publishes citation-safe metadata, authoritative source IDs, and an immutable corpus revision. See [Chat RAG Workflow](./docs/RAG-WORKFLOW.md) for the complete contract and current readiness status.

### 📝 AI Quiz — Test Your Knowledge

Choose a topic, and the AI generates multiple-choice questions on the spot. No waiting — questions arrive in one batch with a handy phase indicator showing progress.

![Quiz screenshot](/public/quiz_screenshot.png)

The flow is dead simple:

```
You pick a topic
    │
    ▼
loadContent(topicId) → quiz-content.json (static content)
    │
    ▼
streamText → LLM generates JSON → parse → validate
    │
    ├── data-question (SSE) — all questions at once
    └── [DONE]
    │
    ▼
Quiz appears with timer, pagination, and results
```

**🔧 Key components:**
- **`app/api/quiz/route.ts`** — SSE streaming endpoint (60s timeout)
- **`lib/services/quiz-pipeline.ts`** — Content loading + `streamText` + JSON parse
- **`data/quiz-content.json`** — Curated Pali grammar content by topic
- **`components/ai/quiz-status.tsx`** — Phase indicator (searching → generating)
- **`hooks/use-quiz.ts`** — Orchestrator tying everything together

**✨ Highlights:**
- 📚 No vector DB needed — context comes from a curated JSON file (token's cost savings)
- ⚡ Single LLM call — no multi-step tool loops, works with any provider
- 🎯 Phase indicator shows "กำลังค้นหาเนื้อหา..." → "กำลังสร้างคำถาม..."

> 📖 See [`docs/RAG-WORKFLOW.md`](./docs/RAG-WORKFLOW.md) and [`docs/QUIZ-WORKFLOW.md`](./docs/QUIZ-WORKFLOW.md) for full architecture details.

## 🚀 Getting Started for Contributors

### 1️⃣ Service prerequisites

| Service | Used for | Required configuration |
| --- | --- | --- |
| **Pinecone** | RAG query embeddings and vector retrieval | API key, index, optional namespace, and a verified corpus revision |
| **OpenRouter** or **OpenCode** | Chat and quiz model calls | Selected provider's API key and model ID |
| **Algolia** | Documentation full-text search | Application ID, public search key, and server-only admin key |

`PROVIDER_NAME` accepts `openrouter` or `opencode` and defaults to `openrouter` only when it is absent. The selected provider's API key and model ID are required; model IDs have no built-in defaults. Copy `.env.example` to `apps/web/.env.local` for the complete variable list and exact retrieval defaults.

### 2️⃣ Pinecone ingestion contract

The quiz feature reads `data/quiz-content.json` and does not need Pinecone. RAG chat requires an externally ingested Pinecone corpus. This repository contains the query-time application, not the production Pinecone ingestion pipeline.

Each indexed chunk must have:

- a nonempty vector ID;
- nonempty `text`, stable authoritative `source`, and human-readable `title` metadata;
- optional `section` metadata; and
- revision metadata matching one immutable `PINECONE_CORPUS_REVISION` for the complete index build.

Passages must be embedded with `llama-text-embed-v2` and Pinecone `inputType: "passage"`. Runtime searches use the same model with `inputType: "query"`. The ingestion owner must also provide the authoritative `source`-ID mapping for evaluation. Do not invent source IDs or weaken citation validation when metadata is missing.

Before enabling the two-attempt retrieval flow for unrestricted production traffic, deployment also requires an authenticated-user or platform abuse budget and a distributed rate limit for `/api/question`.

### 3️⃣ Environment

```bash
cp .env.example apps/web/.env.local
```

The RAG route validates model and Pinecone configuration before committing its stream. Required RAG values are `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, and `PINECONE_CORPUS_REVISION`; `PINECONE_NAMESPACE` defaults to the default namespace. Retrieval policy defaults are documented in `.env.example` and `docs/RAG-WORKFLOW.md`.

### 4️⃣ Build and Algolia indexing

```bash
bun run build
```

`bun run build` runs the Next.js production build and then `scripts/update-index.mjs`. That script updates the Algolia `docs` index only; it never updates Pinecone. It requires `NEXT_PUBLIC_ALGOLIA_APP_ID` and the server-only `ALGOLIA_ADMIN_API_KEY`. After a build, `bun run index` can repeat the Algolia sync from generated output.

### 5️⃣ RAG evaluation

```bash
bun run eval:rag
```

The evaluator uses the production AI SDK runner and retriever. It fails closed while `data/rag-eval-cases.json` is incomplete and performs no paid or external calls in that state. A runnable manifest requires at least 30 reviewed cases, the required cohort mix, authoritative source IDs for grounded cases, a corpus revision matching `PINECONE_CORPUS_REVISION`, and a checked-in outcome baseline.

Application code for the route, runner, retriever, event adapter, and evaluation gate is complete. Real browser smoke, the authoritative 30-case baseline, and production citation rollout remain blocked until compliant re-ingestion publishes authoritative source IDs and `PINECONE_CORPUS_REVISION`.

### 6️⃣ Start developing

```bash
bun run dev                       # Development server with Turbopack
bun test                          # Vitest watch mode
bun run test:run                  # Run all tests once
bunx vitest run tests/route.test.ts
```

## 📚 Learn More

- [Next.js Docs](https://nextjs.org/docs) — framework fundamentals
- [Learn Next.js](https://nextjs.org/learn) — interactive tutorial
- [Fumadocs](https://fumadocs.vercel.app) — documentation framework
