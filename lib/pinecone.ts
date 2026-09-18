import { Pinecone, type Index } from "@pinecone-database/pinecone";
import { getRagConfig } from "@/lib/config/rag";

interface PineconeResources {
  apiKey: string;
  indexName: string;
  client: Pinecone;
  index: Index;
}

let cachedResources: PineconeResources | undefined;

function getPineconeResources(): PineconeResources {
  const config = getRagConfig();
  if (
    cachedResources?.apiKey === config.PINECONE_API_KEY &&
    cachedResources.indexName === config.PINECONE_INDEX_NAME
  ) {
    return cachedResources;
  }

  const client = new Pinecone({ apiKey: config.PINECONE_API_KEY });
  cachedResources = {
    apiKey: config.PINECONE_API_KEY,
    indexName: config.PINECONE_INDEX_NAME,
    client,
    index: client.index(config.PINECONE_INDEX_NAME),
  };
  return cachedResources;
}

export function getPineconeClient(): Pinecone {
  return getPineconeResources().client;
}

export function getPineconeIndex(): Index {
  return getPineconeResources().index;
}
