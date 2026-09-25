# Next.js + FastAPI + LangGraph Monorepo Research

## Conclusion

The proposed split is technically supported, but the boundary must be explicit:

```text
Next.js UI/BFF → versioned event adapter → FastAPI → LangGraph → LangChain retrieval → Pinecone
                                      ↑
                         separate LangChain ingestion worker
```

Keep the Next.js BFF during migration. FastAPI owns online model calls and graph execution. Ingestion stays outside the request path.

## Primary-source findings

### Next.js

Next.js documents the Backend-for-Frontend pattern as a public API layer, not a full backend replacement. Route Handlers are publicly reachable and must authenticate/authorize requests. The same guide warns that some hosts deploy handlers as functions with timeouts and limited connection lifetime, which matters for long-running agent streams.

Source: [Next.js Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)

Vercel maintains a separate Next.js + FastAPI services example using a frontend service, a FastAPI service, and rewrites.

Source: [Vercel Next.js + FastAPI example](https://github.com/vercel/examples/tree/main/services/nextjs-fastapi)

### Vercel AI SDK

`useChat` uses an HTTP transport that can target a custom endpoint. The AI SDK supports custom backends written in Python. Its UI Message Stream Protocol uses SSE framing and requires the `x-vercel-ai-ui-message-stream: v1` header for compatible data streams. Text streams are limited to basic text; structured sources, status parts, and tool data require data streams.

Sources:

- [AI SDK transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [AI SDK stream protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [AI SDK streaming custom data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)

### FastAPI

`StreamingResponse` accepts async or synchronous iterables and sends yielded chunks as-is. It does not provide AI SDK framing automatically. Awaitable I/O belongs in `async def`; blocking operations require an explicit threadpool or worker boundary.

Sources:

- [FastAPI concurrency](https://fastapi.tiangolo.com/async/)
- [FastAPI stream data](https://fastapi.tiangolo.com/advanced/stream-data/)

### LangGraph

LangGraph is the stateful orchestration/runtime layer: shared state, nodes, conditional edges, streaming modes, and optional checkpointing. Graphs must be compiled before use. Checkpoints are thread-scoped snapshots; stores are a separate mechanism for cross-thread long-term data. Full graph state should not cross the public stream boundary without an explicit output projection.

Sources:

- [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)
- [LangGraph streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

### LangChain and Pinecone

LangChain describes retrieval as a pipeline of loaders, documents, splitters, embeddings, vector stores, and retrievers. Pinecone stores searchable vector records and does not split source documents into chunks at index time; the application must chunk before upsert and preserve parent/source metadata.

Sources:

- [LangChain retrieval](https://docs.langchain.com/oss/python/deepagents/retrieval)
- [LangChain vector stores](https://docs.langchain.com/oss/python/integrations/vectorstores)
- [Pinecone semantic search](https://docs.pinecone.io/guides/search/semantic-search)
- [Pinecone data modeling](https://docs.pinecone.io/guides/index-data/data-modeling)

## Repository implications

The repository is currently one Bun-managed Next.js application. `app/api/question/route.ts` owns the HTTP stream, `lib/agent/ai-sdk-runner.ts` owns the current agent workflow, and `lib/rag/retriever.ts` owns Pinecone retrieval and citation construction. There is no Python project, workspace configuration, or LangGraph implementation yet.

The existing framework-neutral `AgentTurnRunner` and `AgentEventSink` contracts are the cleanest migration seam. Preserve their observable behavior at the network boundary rather than copying their TypeScript implementation into Python.

## Research decision

Use a framework-neutral, versioned backend event contract internally. Keep the AI SDK UI Message Stream Protocol at the Next.js BFF boundary during migration. A direct FastAPI-to-AI-SDK stream may be evaluated later, but it should not be the first migration step.
