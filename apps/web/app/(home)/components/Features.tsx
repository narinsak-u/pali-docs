// import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";
import {
  CheckLine,
  CpuIcon,
  FileEditIcon,
  FileTextIcon,
  LayoutIcon,
  LibraryIcon,
  LucideIcon,
  PaperclipIcon,
  SearchIcon,
  Terminal,
} from "lucide-react";
// import Image from "next/image";
import Link from "next/link";
import { HTMLAttributes, ReactNode } from "react";

function Features() {
  return (
    <div lang="th" className="grid grid-cols-1 border-r md:grid-cols-2">
      <Feature
        icon={PaperclipIcon}
        subheading="เรียนรู้อย่างมีประสิทธิภาพ"
        heading="ค้นคว้าและเรียนรู้อย่างเป็นระบบ"
        description={
          <>
            <span>
              ด้วยเนื้อหาที่ครอบคลุมทุกระดับ จัดหมวดหมู่ชัดเจน
              สะดวกต่อการค้นคว้า
              พร้อมให้คุณเรียนรู้ได้ด้วยตนเองอย่างมีประสิทธิภาพ
              และทบทวนความรู้ด้วยแบบทดสอบที่สร้างขึ้นโดยปัญญาประดิษฐ์ (AI)
            </span>
          </>
        }
        className="overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(circle at 60% 50%,var(--color-fd-secondary),var(--color-fd-background) 80%)",
        }}
      >
        <div className="mt-2 flex flex-col">
          {/* <Image
            alt="Source"
            src={"/items.png"}
            // sizes="600px"
            width={600}
            height={600}
            className="w-[400px] min-w-[400px] invert pointer-events-none dark:invert-0"
          /> */}

          <div className="mt-8 flex flex-col gap-4">
            <Link
              href="/docs/part-1"
              className="rounded-xl bg-gradient-to-br from-transparent via-fd-primary p-px shadow-lg shadow-fd-primary/20"
            >
              <div className="rounded-[inherit] bg-fd-background bg-gradient-to-br from-transparent via-fd-primary/10 p-4 transition-colors hover:bg-fd-muted">
                <LibraryIcon />
                <h3 className="font-semibold mt-1">เริ่มต้นเข้าสู่บทเรียน</h3>
                <p className="text-sm text-fd-muted-foreground">
                  ศึกษาบาลีอย่างเป็นขั้นตอนด้วยเนื้อหาที่เป็นระบบและเข้าใจง่าย
                </p>
              </div>
            </Link>
            <Link
              href="/quiz"
              className="rounded-xl border bg-fd-background p-4 shadow-lg transition-colors hover:bg-fd-muted"
            >
              <CheckLine />
              <h3 className="font-semibold mt-1">ทำแบบทดสอบ</h3>
              <p className="text-sm text-fd-muted-foreground">
                ทำแบบทดสอบที่ออกแบบโดยเอไอเพื่อประเมินทักษะภาษาบาลี
              </p>
            </Link>
          </div>
          {/* <div className="z-2 mt-[-170px] w-[300px] overflow-hidden rounded-lg border border-fd-foreground/10 shadow-xl backdrop-blur-lg">
            <div className="flex flex-row items-center gap-2 bg-fd-muted/50 px-4 py-2 text-xs font-medium text-fd-muted-foreground">
              <FileEditIcon className="size-4" />
              MDX Editor
            </div>
            <pre className="p-4 text-[13px]">
              <code className="grid">
                <span className="font-medium"># Hello World!</span>
                <span>This is my first document.</span>
                <span>{` `}</span>
                <span className="font-medium">{`<ServerComponent />`}</span>
              </code>
            </pre>
          </div> */}
        </div>
      </Feature>
      <Feature
        icon={SearchIcon}
        subheading="ยกระดับการค้นหา"
        heading="ด้วย AI (AI-Powered Search)"
        description="ที่ช่วยให้คุณเข้าถึงข้อมูลบาลีที่ต้องการได้อย่างรวดเร็วและแม่นยำ เพียงแค่พิมพ์คำศัพท์หรือประโยคที่สนใจ AI ก็พร้อมวิเคราะห์และนำเสนอผลลัพธ์ที่ตรงใจ พร้อมคำอธิบายที่เข้าใจง่าย"
      >
        {/* <Link
          href="/docs/headless/search/algolia"
          className={cn(
            buttonVariants({ variant: "outline", className: "mt-4" })
          )}
        >
          Learn More
        </Link> */}
        <Search />
      </Feature>
      {/* <Feature
        icon={Terminal}
        subheading="Fumadocs CLI"
        heading="The Shadcn UI for docs"
        description="Fumadocs CLI creates interactive components for your docs, offering a rich experience to your users."
      >
        <div className="relative">
          <div className="grid grid-cols-[1fr_2fr_1fr] h-[220px] *:border-fd-foreground/50 *:border-dashed mask-radial-circle mask-radial-from-white">
            <div className="border-r border-b" />
            <div className="border-b" />
            <div className="border-l border-b" />

            <div className="border-r" />
            <div className="w-[200px]" />
            <div className="border-l" />

            <div className="border-r border-t" />
            <div className="border-t" />
            <div className="border-l border-t" />
          </div>
          <code className="absolute inset-0 flex items-center justify-center">
            <code className="text-sm text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-fd-foreground font-medium">
              npx @fumadocs/cli add
            </code>
          </code>
        </div>
      </Feature>
      <Feature
        icon={CpuIcon}
        subheading="Robust"
        heading="Flexibility that cover your needs."
        description="Well documented, separated in packages."
      >
        <div className="mt-8 flex flex-col gap-4">
          <Link
            href="/docs/ui"
            className="rounded-xl bg-gradient-to-br from-transparent via-fd-primary p-px shadow-lg shadow-fd-primary/20"
          >
            <div className="rounded-[inherit] bg-fd-background bg-gradient-to-br from-transparent via-fd-primary/10 p-4 transition-colors hover:bg-fd-muted">
              <LayoutIcon />
              <h3 className="font-semibold">Fumadocs UI</h3>
              <p className="text-sm text-fd-muted-foreground">
                Default theme of Fumadocs with many useful components.
              </p>
            </div>
          </Link>
          <Link
            href="/docs/headless"
            className="rounded-xl border bg-fd-background p-4 shadow-lg transition-colors hover:bg-fd-muted"
          >
            <LibraryIcon />
            <h3 className="font-semibold">Core</h3>
            <p className="text-sm text-fd-muted-foreground">
              Headless library with a useful set of utilities.
            </p>
          </Link>
        </div>
      </Feature> */}
    </div>
  );
}

export default Features;

function Feature({
  className,
  icon: Icon,
  heading,
  subheading,
  description,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  icon: LucideIcon;
  subheading: ReactNode;
  heading: ReactNode;
  description: ReactNode;
}): React.ReactElement {
  return (
    <div
      className={cn("border-l border-t px-6 py-12 md:py-16", className)}
      {...props}
    >
      <div className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-fd-muted-foreground">
        <Icon className="size-4" />
        <p>{subheading}</p>
      </div>
      <h2 className="mb-2 text-lg font-semibold">{heading}</h2>
      <p className="text-fd-muted-foreground">{description}</p>

      {props.children}
    </div>
  );
}

const searchItemVariants = cva(
  "flex flex-row items-center gap-2 rounded-md p-2 text-sm text-fd-popover-foreground"
);

function Search(): React.ReactElement {
  return (
    <div className="mt-8 rounded-lg bg-gradient-to-b from-fd-border p-px">
      <div className="flex select-none flex-col rounded-[inherit] bg-gradient-to-b from-fd-popover">
        <div className="inline-flex items-center gap-2 px-4 py-2 text-sm text-fd-muted-foreground">
          <SearchIcon className="size-4" />
          Search...
        </div>
        <div lang="th" className="border-t p-2">
          {["อักขรวิธี", "วจีวิภาค", "วากยสัมพันธ์", "ฉันทลักษณะ"].map(
            (v, i) => (
              <div
                key={v}
                className={cn(
                  searchItemVariants({
                    className: i === 0 ? "bg-fd-accent" : "",
                  })
                )}
              >
                <FileTextIcon className="size-4 text-fd-muted-foreground" />
                {v}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
