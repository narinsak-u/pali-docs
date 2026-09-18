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

Got a question about Pali grammar? The AI chat searches the textbook corpus and answers with relevant references — like having a Pali scholar right beside you.

![Chat screenshot](/public/chat_screenshot.png)

Here's how it works under the hood:

```
You ask a question
    │
    ▼
LLM decides to search ──► searchDocs tool
    │                           │
    │                     generateEmbedding(query)
    │                           │
    │                     queryPinecone(vector)
    │                           │
    │                     formatContext(matches)
    │                           │
    ▼                           ▼
prepareStep injects context into system prompt
    │
    ▼
LLM responds with grounded answer + follow-up suggestions
```

**🔧 Key components:**
- **`app/api/question/route.ts`** — Route handler orchestrating the stream
- **`lib/services/rag-pipeline.ts`** — `searchDocuments()` (embed → query → format)
- **`lib/services/vector-store.ts`** — Pinecone query & context formatting
- **`lib/services/embedding.ts`** — Text embedding via Pinecone inference (LRU-cached)
- **`lib/chat/pali-system-prompt.ts`** — Pali expert role definition

**✨ Highlights:**
- 🧠 Smart search — Pinecone is called only once per question, cached for follow-ups
- 🔧 Up to 5 tool-calling steps for DeepSeek compatibility
- 💡 Suggests 3 follow-up questions after every answer

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

### 1️⃣ Sign Up for Services

You'll need these free accounts to run the AI features:

| Service | What It's For | How to Get |
|---------|--------------|------------|
| 🗄️ **Pinecone** | Vector DB for RAG chat search | [Sign up](https://www.pinecone.io) → Create index (dimension: `1024`, metric: `cosine`) → Grab API key |
| 🤖 **OpenRouter** or **OpenCode** | LLM provider | Pick one → [openrouter.ai](https://openrouter.ai) or [opencode.ai](https://opencode.ai) → Create API key |
| 🔍 **Algolia** | Full-text search for docs | [Sign up](https://www.algolia.com) → Create app → Get search & admin keys |

### 2️⃣ Set Up the Vector Database (for RAG Chat only)

The quiz feature doesn't need Pinecone — it uses `data/quiz-content.json`. But the RAG chat needs textbook content indexed in Pinecone first.

**Option A — HuggingFace Dataset:**
```
1. Find a Pali textbook dataset on HuggingFace
2. Load it with:
   from datasets import load_dataset
   dataset = load_dataset("your-org/pali-textbooks")
```

**Option B — Local MDX Content (current approach):**
```
The project uses Fumadocs MDX files in content/docs/ as the source.
The static.json endpoint extracts content at build time for Algolia.
For Pinecone you'll need a separate upsert script.
```

### 3️⃣ Process Data Through the Pipeline

```
Raw Text → Clean → Chunk → Embed → Upsert to Pinecone
```

**a) 🧹 Cleaning** — Strip artifacts, normalize Unicode:
```
- Remove HTML/markdown leftovers
- Normalize Thai/Pali characters (NFKC)
- Drop empty or near-empty segments
```

**b) ✂️ Chunking** — Split into searchable pieces:
```
- Aim for 500-1000 character chunks with 100-char overlap
- Respect paragraph boundaries when splitting
- Keep document title/source metadata with each chunk
```

**c) 🧠 Embedding** — Convert text to vectors:

| Model | Provider | Dimensions | Used For |
|-------|----------|------------|----------|
| `llama-text-embed-v2` | Pinecone Inference API | 1024 | RAG context retrieval (chat only) |

```ts
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const result = await pc.inference.embed("llama-text-embed-v2", [text], {
  inputType: "passage",
  truncate: "END",
});
```

**d) 📤 Upsert to Pinecone:**

```ts
await index.namespace("your-namespace").upsert([
  {
    id: "doc-1-chunk-0",
    values: embeddingVector,
    metadata: { text: "...", source: "...", title: "..." },
  },
]);
```

> **Note:** There's no built-in Pinecone upsert script yet. You'll need to write one following the pattern above.

### 4️⃣ Choose Your LLM

Set `PROVIDER_NAME` to pick your backend (`openrouter` or `opencode`, default: `openrouter`).

| Feature | Default Model |
|---------|--------------|
| 🗣️ **RAG Chat** | Configurable per provider |
| 📝 **Quiz Generation** | Configurable per provider |

| Provider | Env Var | Default Model |
|----------|---------|---------------|
| OpenRouter | `OPENROUTER_LLM_MODEL` | `google/gemma-3-27b-it:free` |
| OpenCode | `OPENCODE_LLM_MODEL` | `deepseek-v4-flash` |

Both use `createOpenAICompatible` from `@ai-sdk/openai-compatible` (see `lib/services/llm-provider.ts`).

### 5️⃣ Configure Environment

Copy `.env.example` → `.env.local`:

```env
# 🤖 LLM Provider (pick one - openrouter (free or pay-as-you-go), and opencode (need to subscribe Go at least)
PROVIDER_NAME=openrouter   # or "opencode"

# Option A: OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_LLM_MODEL=google/gemma-3-27b-it:free

# Option B: OpenCode
OPENCODE_API_KEY=sk-...
OPENCODE_LLM_MODEL=deepseek-v4-flash

# 🗄️ Pinecone (needed for RAG Chat, NOT for Quiz)
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX_NAME=pali-docs
PINECONE_NAMESPACE=textbooks

# 🔍 Algolia (full-text search)
NEXT_PUBLIC_ALGOLIA_APP_ID=...
NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY=...
ALGOLIA_API_KEY=...
ALGOLIA_INDEX_NAME=pali_docs
```

### 6️⃣ Run Indexing

```bash
# Build first (generates static.json)
bun run build

# Sync to Algolia
bun run index

# For Pinecone: run your own upsert script
bun scripts/upsert-pinecone.mjs
```

### 7️⃣ Start Developing

```bash
bun run dev          # Dev server with Turbopack
bun test             # Watch mode tests
bun run test:run     # Run all tests once
bunx vitest run tests/route.test.ts  # Single test
```

## 📚 Learn More

- [Next.js Docs](https://nextjs.org/docs) — framework fundamentals
- [Learn Next.js](https://nextjs.org/learn) — interactive tutorial
- [Fumadocs](https://fumadocs.vercel.app) — documentation framework
