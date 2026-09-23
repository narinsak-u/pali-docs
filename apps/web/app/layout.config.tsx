import { siteMetadata } from "@/site.config";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { NotebookPen, CheckLine, LibraryIcon } from "lucide-react";

export const logo = (
  <div lang="en" className="flex items-center  gap-2">
    <LibraryIcon size={20} />
    <span className="font-medium [.uwu_&]:hidden [header_&]:text-[15px]">
      Palidocs
    </span>
  </div>
);

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  githubUrl: `${siteMetadata.github.url}/${siteMetadata.github.repo}`,
  nav: {
    title: logo,
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: [
    {
      icon: <NotebookPen />,
      text: "บทความ",
      url: "/blog",
      // secondary items will be displayed differently on navbar
      secondary: false,
    },
    {
      icon: <CheckLine />,
      text: "แบบทดสอบ",
      url: "/quiz",
      secondary: false,
    },
    // {
    //   icon: <CheckLine />,
    //   text: "ถามตอบ",
    //   url: "/question",
    //   secondary: false,
    // },
  ],
};
