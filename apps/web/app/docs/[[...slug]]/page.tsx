import { getCachedPage, source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/mdx-components";
import { LLMCopyButton, ViewOptions } from "@/components/ai/page-actions";
import { siteMetadata } from "@/site.config";

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = getCachedPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{ style: "clerk" }}
      lastUpdate={
        page.data.lastModified ? new Date(page.data.lastModified) : undefined
      }
      breadcrumb={{
        includeRoot: true,
        includeSeparator: true,
      }}
      footer={{
        enabled: true,
      }}
      editOnGithub={{
        owner: siteMetadata.github.owner,
        repo: siteMetadata.github.repo,
        sha: siteMetadata.github.branch,
        path: `apps/web/content/docs/${page.path}`,
      }}
      // article={{
      //   className: "max-sm:pb-16",
      // }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>

      <div lang="en" className="flex flex-row gap-2 items-center border-b pb-6">
        <LLMCopyButton markdownUrl={`${page.url}.mdx`} />
        <ViewOptions
          markdownUrl={`${page.url}.mdx`}
          githubUrl={`https://github.com/${siteMetadata.github.owner}/${siteMetadata.github.repo}/blob/dev/apps/web/content/docs/${page.path}`}
        />
      </div>

      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = getCachedPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
