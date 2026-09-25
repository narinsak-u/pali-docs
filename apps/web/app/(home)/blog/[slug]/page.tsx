import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { InlineTOC } from "fumadocs-ui/components/inline-toc";
import { blog, getCachedBlogPage } from "@/lib/source";
import { createMetadata } from "@/lib/metadata";
import { buttonVariants } from "@/components/ui/button";
import { Control } from "@/app/(home)/blog/[slug]/page.client";
import { getMDXComponents } from "@/mdx-components";
import path from "node:path";

export default async function Page(props: {
  params: Promise<{ slug: string }>;
}) {
  const params = await props.params;
  const page = getCachedBlogPage(params.slug);

  if (!page) notFound();
  const { body: Mdx, toc } = await page.data.load();

  return (
    <div lang="mixed" id="blog-page" className="leading-relaxed">
      <div
        className="container rounded-xl mt-12 py-12 md:px-8"
        style={{
          backgroundColor: "black",
          backgroundImage: [
            "linear-gradient(140deg, rgba(255,165,0,0.5), transparent 50%)",
            "linear-gradient(to left top, rgba(255,140,0,0.5), transparent 80%)",
            "radial-gradient(circle at 100% 100%, rgba(255,69,0,0.3), oklch(0.646 0.222 41.116 / 1) 17%, oklch(0.646 0.222 41.116 / 0.5) 20%, transparent)",
          ].join(", "),
          backgroundBlendMode: "difference, normal, normal",
        }}
      >
        <h1 className="mb-2 text-4xl font-extrabold text-white">
          {page.data.title}
        </h1>
        <p className="mb-4 text-white/80 font-semibold">
          {page.data.description}
        </p>
        <Link
          href="/blog"
          className={buttonVariants({ size: "sm", variant: "secondary" })}
        >
          Back
        </Link>
      </div>
      <article
        // lang="th"
        className="container flex flex-col px-0 py-8 lg:flex-row lg:px-4 font-normal leading-relaxed"
      >
        <div className="prose min-w-0 flex-1 p-4">
          <InlineTOC items={toc} />
          <Mdx components={getMDXComponents()} />
        </div>
        <div
          lang="en"
          className="flex flex-col gap-4 border-l p-4 text-sm lg:w-[250px]"
        >
          <div>
            <p className="mb-1 text-fd-muted-foreground">Written by</p>
            <p className="font-medium">{page.data.author}</p>
          </div>
          <div>
            <p className="mb-1 text-sm text-fd-muted-foreground">At</p>
            <p className="font-medium">
              {new Date(
                page.data.date ??
                  path.basename(page.path, path.extname(page.path))
              ).toDateString()}
            </p>
          </div>
          <Control url={page.url} />
        </div>
      </article>
    </div>
  );
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = getCachedBlogPage(params.slug);

  if (!page) notFound();

  return createMetadata({
    title: page.data.title,
    description:
      page.data.description ?? "The library for building documentation sites",
  });
}

export function generateStaticParams(): { slug: string }[] {
  return blog.getPages().map((page) => ({
    slug: page.slugs[0],
  }));
}
