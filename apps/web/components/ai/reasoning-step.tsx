export function ReasoningStep({
  summary,
  excerpts,
}: {
  summary: string;
  excerpts?: string[];
}) {
  return (
    <div
      data-testid="reasoning-step"
      className="rounded-md border border-purple-300 bg-purple-50 dark:bg-purple-950/40 dark:border-purple-800 px-3 py-2 text-sm text-purple-900 dark:text-purple-200"
    >
      <span className="font-semibold mr-2">Reasoning:</span>
      {summary}
      {excerpts && excerpts.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-purple-700 dark:text-purple-300">
          {excerpts.map((excerpt, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-purple-400 dark:bg-purple-600" />
              {excerpt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
