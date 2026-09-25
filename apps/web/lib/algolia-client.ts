import { liteClient } from "algoliasearch/lite";

const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID as string;
const apiKey = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY as string;

if (!appId || !apiKey) {
  console.error("Missing Algolia credentials");
}

const client = liteClient(appId, apiKey);

export default client;
