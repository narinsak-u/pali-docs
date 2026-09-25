import { NextResponse } from "next/server";
import { type DocumentRecord } from "fumadocs-core/search/algolia";
import { source } from "@/lib/source";

export const revalidate = false;

function createHierarchy(title: string, description?: string) {
  return {
    lvl0: "Documentation",
    lvl1: title,
    lvl2: description || null,
    lvl3: null,
    lvl4: null,
    lvl5: null,
    lvl6: null,
  };
}

export function GET() {
  const results: DocumentRecord[] = [];

  // for (const page of source.getPages()) {
  //   results.push({
  //     _id: page.url,
  //     structured: page.data.structuredData,
  //     url: page.url,
  //     title: page.data.title,
  //     description: page.data.description,
  //   });
  // }

  for (const page of source.getPages()) {
    const hierarchy = createHierarchy(page.data.title, page.data.description);
    const headings = page.data.structuredData?.headings || [];

    // Main page record with content-based hierarchy
    results.push({
      _id: page.url,
      structured: {
        headings: headings,
        contents: page.data.structuredData?.contents || null,
      },
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      extra_data: {
        hierarchy,
        type: "lvl1",
        content: page.data.description || null,
        objectID: page.url,
      },
    });

    // Create records for each heading
    headings.forEach((heading: any, index: number) => {
      const headingHierarchy = {
        lvl0: "Documentation",
        lvl1: page.data.title,
        lvl2: page.data.description || null,
        lvl3: heading.content,
        lvl4: null,
        lvl5: null,
        lvl6: null,
      };

      results.push({
        _id: `${page.url}#${heading.slug || index}`,
        structured: {
          headings: [heading],
          contents: page.data.structuredData?.contents || null,
        },
        url: `${page.url}#${heading.slug || ""}`,
        title: heading.content,
        description: heading.content,
        extra_data: {
          hierarchy: headingHierarchy,
          type: "lvl3",
          content: heading.content || null,
          objectID: `${page.url}#${heading.slug || index}`,
        },
      });
    });
  }

  return NextResponse.json(results);
}
