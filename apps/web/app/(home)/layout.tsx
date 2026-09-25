import { baseOptions, logo } from "@/app/layout.config";
import type { ReactNode } from "react";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  NavbarMenu,
  NavbarMenuContent,
  NavbarMenuLink,
  NavbarMenuTrigger,
} from "fumadocs-ui/layouts/home/navbar";
import Link from "next/link";
import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import TrackedLink from "@/components/TrackedLink";
import { mainMenuData } from "@/data/mainMenuData";
import React from "react";
import { CheckLine, Pin } from "lucide-react";
import { siteMetadata } from "@/site.config";
import AlgoliaSearchLoader from "@/components/search/AlgoliaSearchLoader";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      lang="th"
      {...baseOptions}
      style={
        {
          "--spacing-fd-container": "1120px",
        } as object
      }
      searchToggle={{
        components: {
          lg: <AlgoliaSearchLoader />,
        },
      }}
      links={[
        // mobile menu items
        {
          type: "menu",
          on: "menu",
          text: "Documentation",
          items: mainMenuData.map((item) => ({
            text: item.title,
            url: item.href,
            icon: item.icon,
          })),
        },
        // only displayed on navbar, not mobile menu
        {
          type: "custom",
          on: "nav",
          children: <MainMenu />,
        },
        // other items
        ...(baseOptions.links ?? []),

        {
          type: "custom",
          children: <Reference />,
          secondary: true,
        },
      ]}
    >
      {children}
      <Footer />
    </HomeLayout>
  );
}

const MainMenu = () => (
  <NavbarMenu lang="th">
    <NavbarMenuTrigger>
      <Link href="/docs/part-1">เมนูหลัก</Link>
    </NavbarMenuTrigger>
    <NavbarMenuContent lang="th" className="text-[15px]">
      <NavbarMenuLink href="/docs/part-1" className="md:row-span-2">
        <div className="-mx-3 -mt-3">
          <Image
            src="/Screenshot.png"
            width={500}
            height={200}
            layout="responsive"
            alt="Perview"
            className="rounded-t-lg object-cover"
            style={{
              maskImage: "linear-gradient(to bottom,white 60%,transparent)",
            }}
          />
        </div>
        <p className="font-medium">เริ่มต้นเรียนบาลีไวยากรณ์</p>
        <p className="text-muted-foreground text-sm">
          เรียนรู้บาลีไวยากรณ์และค้นคว้าได้ด้วยตัวเองอย่างมีประสิทธิภาพ
        </p>
      </NavbarMenuLink>

      <NavbarMenuLink href={mainMenuData[0].href} className="lg:col-start-2">
        {React.createElement(mainMenuData[0].icon.type, {
          className: "bg-primary text-primary-foreground p-1 mb-2 rounded-md",
        })}
        <p className="font-medium">{mainMenuData[0].title}</p>
        <p className="text-muted-foreground text-sm">
          {mainMenuData[0].description}
        </p>
      </NavbarMenuLink>

      <NavbarMenuLink href={mainMenuData[1].href} className="lg:col-start-2">
        {React.createElement(mainMenuData[1].icon.type, {
          className: "bg-primary text-primary-foreground p-1 mb-2 rounded-md",
        })}
        <p className="font-medium">{mainMenuData[1].title}</p>
        <p className="text-muted-foreground text-sm">
          {mainMenuData[1].description}
        </p>
      </NavbarMenuLink>

      <NavbarMenuLink
        href={mainMenuData[2].href}
        className="lg:col-start-3 lg:row-start-1"
      >
        {React.createElement(mainMenuData[2].icon.type, {
          className: "bg-primary text-primary-foreground p-1 mb-2 rounded-md",
        })}
        <p className="font-medium">{mainMenuData[2].title}</p>
        <p className="text-muted-foreground text-sm">
          {mainMenuData[2].description}
        </p>
      </NavbarMenuLink>

      <NavbarMenuLink
        href={mainMenuData[3].href}
        className="lg:col-start-3 lg:row-start-2"
      >
        {React.createElement(mainMenuData[3].icon.type, {
          className: "bg-primary text-primary-foreground p-1 mb-2 rounded-md",
        })}
        <p className="font-medium">{mainMenuData[3].title}</p>
        <p className="text-muted-foreground text-sm">
          {mainMenuData[3].description}
        </p>
      </NavbarMenuLink>
    </NavbarMenuContent>
  </NavbarMenu>
);

const Reference = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="secondary" className="rounded-full" asChild>
        <TrackedLink
          href={siteMetadata.refSiteUrl}
          className="font-medium"
          target="_blank"
        // goal="sponsor_ikiform_click"
        >
          <div className="flex items-center justify-center gap-2">
            <Pin />
            <p>pali-on-demand</p>
          </div>
        </TrackedLink>
      </Button>
    </TooltipTrigger>
    <TooltipContent className="bg-fd-card text-fd-muted-foreground hidden md:block">
      <p>The original content is available on pali-on-demand</p>
    </TooltipContent>
  </Tooltip>
);

function Footer() {
  return (
    <footer
      lang="en"
      className="mt-auto border-t bg-fd-card py-12 text-fd-secondary-foreground"
    >
      <div className="container flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {logo}
          <p className="text-xs mt-2">
            Built with 🧡 by{" "}
            <a
              href={siteMetadata.github.url}
              rel="noreferrer noopener"
              target="_blank"
              className="font-medium"
            >
              {siteMetadata.github.owner}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

