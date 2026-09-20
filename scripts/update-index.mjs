import 'dotenv/config';

import { algoliasearch } from "algoliasearch";
import { sync } from "fumadocs-core/search/algolia";
import * as fs from "node:fs";
import * as path from "node:path";
import fetch from "node-fetch";

const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID || '';
const apiKey = process.env.ALGOLIA_ADMIN_API_KEY || ''; // must be admin key

if (!appId || !apiKey) {
  throw new Error("Missing NEXT_PUBLIC_ALGOLIA_APP_ID or ALGOLIA_ADMIN_API_KEY environment variables.");
}

const client = algoliasearch(appId, apiKey);
const indexName = "docs"; // Change if needed

async function loadRecords() {
  const filePath = path.resolve(".next/server/app/static.json.body");

  if (fs.existsSync(filePath)) {
    console.log("✅ Found static.json.body, reading from build output...");
    const content = fs.readFileSync(filePath);
    return JSON.parse(content.toString());
  }

  // Dev fallback: try fetching from running local dev server
  const localUrl = "http://localhost:3000/static.json";

  try {
    console.warn("⚠️ static.json.body not found. Trying to fetch from dev server:", localUrl);
    const res = await fetch(localUrl);

    if (!res.ok) {
      throw new Error(`Failed to fetch static.json: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } catch (error) {
    console.error("❌ Failed to load static.json from local dev server.");
    console.error(error);
    return [];
  }
}

// Configure Thai language support
async function configureIndexForThai() {

  try {
    await client.setSettings({
      indexName,
      indexSettings: {
        // Enable Thai language support
        queryLanguages: ['en', 'th'],
        indexLanguages: ['en', 'th'],

        // Configure searchable attributes
        searchableAttributes: [
          'title',
          'description',
          'content',
          'structured.headings',
        ],

        // Enable highlighting for Thai text
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',

        // Configure ranking for better results
        customRanking: [
          'desc(weight.title)',
          'desc(weight.content)',
        ],
      }
    });

    console.log('✅ Index configured for Thai language support');
  } catch (error) {
    console.warn('⚠️ Could not configure index settings:', error.message);
  }
}

async function main() {
  // Configure index for Thai language first
  await configureIndexForThai();

  // Load records
  const records = await loadRecords();

  if (!records.length) {
    console.warn("⚠️ No documents found to sync.");
    return;
  }

  try {
    const result = await sync(client, {
      indexName,
      documents: records,
    });

    console.log(`✅ Successfully indexed ${records.length} documents to Algolia index "${indexName}"`);
  } catch (error) {
    console.error("❌ Failed to sync records to Algolia:");
    console.error(error);
  }
}

main();
