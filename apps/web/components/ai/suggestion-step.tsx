import { cn } from "@/lib/utils";

export function SuggestionStep({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
}) {
  return (
    <div data-testid="suggestion-step" className="flex flex-wrap gap-2">
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(s)}
          className={cn(
            "rounded-full cursor-pointer border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800",
            "hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
            "dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/60",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
