import client from "@/lib/algolia-client";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  label?: string;
}

export interface SearchOptions {
  query: string;
  hitsPerPage?: number;
  indexName?: string;
}

export interface SearchService {
  search(options: SearchOptions): Promise<SearchResult[]>;
  formatAsContext(results: SearchResult[]): string;
}

function createSearchService(): SearchService {
  return {
    async search({ query, hitsPerPage = 5, indexName = "docs" }) {
      const searchResults = await client.search([
        {
          indexName,
          params: {
            query,
            hitsPerPage,
          },
        },
      ]);

      const results = searchResults.results[0];
      if (!("hits" in results)) return [];

      type AlgoliaHit = { title?: string; url?: string; content?: string };
      return (results.hits as AlgoliaHit[]).map((hit) => ({
        title: hit.title || "",
        url: hit.url || "",
        content: hit.content || "",
      }));
    },

    formatAsContext(results: SearchResult[]): string {
      if (results.length === 0) return "";

      let context = "";
      for (const hit of results) {
        context += `Title: ${hit.title}\n`;
        context += `URL: ${hit.url}\n`;
        context += `Content: ${hit.content}\n\n---\n\n`;
      }
      return context;
    },
  };
}

export const searchService = createSearchService();
