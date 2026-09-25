# Task 3 report — controlled BFF routing and fallback

## Files

- `apps/web/app/api/question/route.ts`
- `apps/web/tests/route.test.ts`
- `.superpowers/sdd/SHADOW-CONTROLLED-TRAFFIC/task-3-report.md`

## Test output

Command:

```text
cd apps/web && bunx vitest run tests/route.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       17 passed (17)
```

## Status

Implemented server-owned rollout selection with LangGraph pre-stream fallback to the existing AI SDK runner. LangGraph responses keep the existing SSE consumer and public stream error behavior after stream creation.

## Commit

`🚦 feat(rollout/bff): add controlled LangGraph routing`

## Concerns

None. No project-wide validation was run per the task brief.
