"use client";

import "@docsearch/css";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { DocSearch } from "@docsearch/react";
import { useTheme } from "next-themes";
import { siteMetadata } from "@/site.config";

type Props = {};

/// Loading fallback
const SearchFallback = () => (
  <div className="flex items-center justify-center p-2">
    <div className="animate-pulse bg-gray-200 rounded-md h-10 w-64">
      <span className="sr-only">Loading search...</span>
    </div>
  </div>
);

// Error fallback
const SearchErrorFallback = ({ error, resetErrorBoundary }: any) => (
  <div className="text-sm text-red-500 p-2">
    <p>Search temporarily unavailable</p>
    <button onClick={resetErrorBoundary} className="text-xs underline mt-1">
      Try again
    </button>
  </div>
);

// DocSearch component
const DocSearchComponent = () => {
  const { theme } = useTheme();

  const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
  const apiKey = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY;
  const assistantId = process.env.NEXT_PUBLIC_ALGOLIA_ASSISTANT_ID as string;

  if (!appId || !apiKey || !assistantId) {
    throw new Error("Algolia credentials not configured");
  }

  return (
    <div>
      <DocSearch
        appId={appId}
        apiKey={apiKey}
        indexName="docs"
        placeholder="Search documentation..."
        transformItems={(items) =>
          items.map((item) => ({
            ...item,
            // url: `${window.location.origin}${item.url}`,
            url: `${siteMetadata.baseUrl}${item.url}`,
            // url: `${siteMetadata.devUrl}${item.url}`,
          }))
        }
        searchParameters={{
          hitsPerPage: 20,
          // attributesToRetrieve: [
          //   "hierarchy",
          //   "content",
          //   "url",
          //   "type",
          //   "title",
          //   "description",
          // ],
        }}
        theme={theme === "light" ? "light" : "dark"}
        askAi={{
          assistantId,
          apiKey,
          appId,
          indexName: "docs",
        }}
      />
    </div>

    // # Testing
    // <DocSearch
    //   appId="PMZUYBQDAK"
    //   apiKey="24b09689d5b4223813d9b8e48563c8f6"
    //   indexName="docsearch"
    // />
  );
};

const AlgoliaSearch = (props: Props) => {
  return (
    <ErrorBoundary
      FallbackComponent={SearchErrorFallback}
      onReset={() => window.location.reload()}
    >
      <Suspense fallback={<SearchFallback />}>
        <DocSearchComponent />
      </Suspense>
    </ErrorBoundary>
  );
};

export default AlgoliaSearch;
