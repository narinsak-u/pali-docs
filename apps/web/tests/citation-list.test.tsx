import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CitationList } from "@/components/ai/citation-list";

describe("CitationList", () => {
  it("renders two escaped sources with optional sections and safe internal links", () => {
    const { container } = render(
      <CitationList
        citations={[
          {
            id: "source-1",
            source: "part-1/chapter-2.mdx",
            title: "ไวยากรณ์บาลี",
            section: "สนธิ",
          },
          {
            id: "source-2",
            source: "part-2/<img src=x onerror=alert(1)>",
            title: "<script>alert('title')</script>",
          },
        ]}
      />,
    );

    expect(screen.getByText("แหล่งอ้างอิง")).toBeInTheDocument();
    expect(screen.getByText("part-1/chapter-2.mdx")).toBeInTheDocument();
    expect(screen.getByText("สนธิ")).toBeInTheDocument();
    expect(
      screen.queryByText("สนธิ", { selector: "a" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("part-2/<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/docs/part-1/chapter-2");
    expect(links[1]?.getAttribute("href")).toMatch(/^\/docs\//);
    expect(links[1]?.getAttribute("href")).not.toMatch(/^(?:javascript|data):/i);
  });

  it("does not create a link for a source containing path traversal", () => {
    render(
      <CitationList
        citations={[
          {
            id: "unsafe",
            source: "../private/secret",
            title: "Unsafe source",
          },
        ]}
      />,
    );

    expect(screen.getByText("../private/secret")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
