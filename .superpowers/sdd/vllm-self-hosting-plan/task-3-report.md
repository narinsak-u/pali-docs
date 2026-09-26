# Task 3 report: route grounded LangGraph turns through local inference

## Implementation

The existing Task 1/2 FastAPI LangGraph seam already routes normal grounded turns through the server-selected provider: `LangGraphAgentRunner` constructs `LangChainModelStages`, and the existing `PROVIDER_NAME=local` branch constructs the private local `ChatOpenAI` client with bounded settings and non-thinking request options. No new provider, route, graph, browser, or public event seam was needed for Task 3.

Task 3 therefore adds observable regression coverage only:

- A full FastAPI question-route integration test uses the real `create_langgraph_agent_turn_runner` factory and default runner path. Only the lower-level `ChatOpenAI` and `PineconeRetriever` network seams are replaced with deterministic doubles.
- The fake local model now inspects the actual structured-stage messages. It asserts the user question reaches classification, and that grounded generation receives the accepted `corpus-revision`, retrieved passage text, and exact citation allow-list before returning a citation-bearing answer. Suggestions also inspect the validated answer.
- The local integration test asserts accepted provenance, answer text, citation IDs, outcome, event ordering, and existing server-owned local model construction values.
- A scoped runner execution uses a non-empty AccessScope and asserts it reaches the retriever through the real graph boundary.
- Explicit in-flight retrieval cancellation coverage blocks retrieval until cancellation, asserts the retriever task is cancelled, preserves AccessScope, and verifies the typed aborted result plus exactly one terminal `run.failed` event.
- Existing graph tests continue to cover bounded insufficient-evidence retry and citation-repair limits.
- Existing hosted-provider rollback coverage remains in the focused provider contract test.

No production code was changed because the current seam already satisfied the Task 3 routing behavior. No Task 4 structured-output/tool additions or Task 5 observability/rollback-policy changes were made.

## Files changed

- `apps/api/tests/test_graph.py`
- `apps/api/tests/test_provider_contract.py`
- `.superpowers/sdd/vllm-self-hosting-plan/task-3-report.md`

## TDD evidence

### RED

The first in-flight cancellation version released the retrieval wait at the same time as setting cancellation. The focused test exposed that this was not deterministic task cancellation:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_graph.py::test_runner_cancellation_during_retrieval_preserves_scope_and_outcome
FAILED ... assert retrieval_cancelled
E       assert False
```

The test was corrected to keep retrieval blocked on a separate release event; the graph cancellation watcher must then cancel the in-flight retrieval task. No production workaround was introduced.

When converting the route test to the real runner factory, the deterministic doubles were moved to the lower-level model/retriever seams rather than replacing `create_langgraph_agent_turn_runner`.

### GREEN

Focused API tests after the review fixes:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_graph.py apps/api/tests/test_question.py apps/api/tests/test_provider_contract.py
pytest: 32 passed, 238 warnings in 0.79s
```

The grounded route test observes this ordered SSE event sequence:

```text
run.started
retrieval.started
retrieval.completed
  acceptedProvenance: p-1 / book-1 / source-v1 / §1
generation.started
answer.completed: Grounded local answer.
citations.completed: p-1
suggestions.completed
run.completed: outcome=answered
```

The structured-call assertions prove the local model boundary receives the user input and grounded evidence with `corpus-revision="corpus-1"`, the accepted passage text, and `Allowed citation IDs: ["p-1"]`. The scoped runner assertion proves `{"tenant":"tenant-1"}` reaches retrieval.

Existing browser-contract checks remain green:

```text
$ bun run test:run tests/route.test.ts
Test Files 1 passed (1)
Tests 19 passed (19)

$ bun run test:run tests/langgraph-event-adapter.test.ts
Test Files 1 passed (1)
Tests 3 passed (3)
```

## Preserved invariants

- **Provider seam:** LangGraph nodes still consume the framework-neutral `AgentModelStages`; provider construction remains centralized in `LangChainModelStages` and the test uses the real runner factory.
- **Grounding/Citation:** retrieved evidence and citation allow-list are asserted at the model boundary; the local run emits only accepted citation `p-1`.
- **CorpusRevision:** the existing FastAPI request validation and retriever bundle revision checks are unchanged; grounded generation receives the active `corpus-1` evidence block.
- **AccessScope:** a non-empty tenant scope is passed through `AgentTurnInput` and observed at the retriever boundary; the cancellation test asserts it remains present while retrieval is in flight.
- **Bounded attempts:** existing graph coverage continues to prove the two-attempt insufficient-evidence path and one citation-repair limit.
- **Cancellation:** in-flight cancellation cancels retrieval, returns `TerminalResult(outcome="failed", code="aborted")`, emits `retrieval.failed` with `aborted`, and ends with exactly one terminal `run.failed` envelope.
- **Outcome/SSE contract:** the local route emits the same versioned event envelopes and terminal `answered` outcome consumed by the existing BFF/browser adapter. No public event vocabulary changed.
- **Rollback:** hosted provider tests remain green, and neither the hosted provider nor the TypeScript runner was removed or altered.

## External runtime limitation

This host is Apple Silicon Darwin without `nvidia-smi` or a Linux NVIDIA GPU, and no private vLLM server is available. I did not claim a real Qwen/vLLM completion or GPU performance smoke test. The available evidence is deterministic local-provider construction, full FastAPI-to-LangGraph-to-SSE route execution, focused cancellation/retry/citation/access-scope tests, and the existing browser stream-contract tests. The pinned deployment and real model completion must be exercised on the target Linux NVIDIA host.

No formatter, linter, or project-wide suite was run.
