import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

export const { GET } = createFromSource(source, {
  // https://docs.orama.com/open-source/supported-languages
  language: "english",
});

// import { source } from "@/lib/source";
// import { createSearchAPI } from "fumadocs-core/search/server";

// export const { GET } = createSearchAPI("advanced", {
//   indexes: source.getPages().map((page) => ({
//     title: page.data.title,
//     description: page.data.description,
//     structuredData: page.data.structuredData,
//     id: page.url,
//     url: page.url,
//   })),
// });
