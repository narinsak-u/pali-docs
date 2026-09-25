import type { CitationsPart } from "@/lib/schemas/ai-data-parts";

function citationHref(source: string): string | null {
  const normalized = source
    .trim()
    .replace(/^content\/docs\//, "")
    .replace(/^\/docs\//, "")
    .replace(/\.mdx?$/i, "");
  const segments = normalized.split("/");

  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    return null;
  }

  return `/docs/${segments.map(encodeURIComponent).join("/")}`;
}

export function CitationList({
  citations,
}: {
  citations: CitationsPart["citations"];
}) {
  if (citations.length === 0) return null;

  return (
    <section aria-label="แหล่งอ้างอิง" className="space-y-2">
      <h3 className="text-sm font-medium text-fd-muted-foreground">
        แหล่งอ้างอิง
      </h3>
      <ol className="space-y-2">
        {citations.map((citation) => {
          const href = citationHref(citation.source);
          return (
            <li
              key={citation.id}
              className="rounded-lg border bg-fd-card px-3 py-2 text-sm"
            >
              <div className="font-medium">{citation.title}</div>
              {citation.section && (
                <div className="text-fd-muted-foreground">
                  {citation.section}
                </div>
              )}
              {href ? (
                <a
                  href={href}
                  className="break-all text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-300"
                >
                  {citation.source}
                </a>
              ) : (
                <span className="break-all text-fd-muted-foreground">
                  {citation.source}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
