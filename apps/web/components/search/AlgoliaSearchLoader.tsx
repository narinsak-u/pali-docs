"use client";

import dynamic from "next/dynamic";

const AlgoliaSearch = dynamic(
  () => import("@/components/search/AlgoliaSearch"),
  { ssr: false }
);

export default function AlgoliaSearchLoader() {
  return <AlgoliaSearch />;
}
