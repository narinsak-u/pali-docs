import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CircleCheckBig, MessageCircleMore } from "lucide-react";
import Link from "next/link";

const End = () => {
  return (
    <div className="flex flex-col border-b border-r md:flex-row *:border-l *:border-t">
      <div className="group flex flex-col min-w-0 flex-1 pt-8 **:transition-colors">
        <h2
          lang="en"
          className="text-3xl text-center font-extrabold font-mono uppercase text-fd-muted-foreground mb-4 lg:text-4xl group-hover:text-orange-500"
        >
          Pali Docs
        </h2>
        <p
          lang="th"
          className="text-center font-mono text-xs text-fd-foreground/60 mb-8 group-hover:text-orange-500/80"
        >
          หยุดพร่ำบ่นว่ามืด แล้วรีบจุดเทียนเล่มน้อยในมือนั้นเสีย — ขงจื้อ
        </p>
        <div className="h-[200px] overflow-hidden p-8 bg-gradient-to-b from-fd-primary/10 group-hover:from-orange-500/10">
          <div className="mx-auto bg-radial-[circle_at_0%_100%] from-60% from-transparent to-fd-primary size-[500px] rounded-full group-hover:from-orange-500 group-hover:to-orange-600/10" />
        </div>
      </div>

      <ul lang="th" className="flex flex-col gap-4 p-6 pt-8">
        <li className="mb-2">
          <span className="flex flex-row items-center gap-2 font-medium">
            <CircleCheckBig className="size-5" />
            การันตีคุณภาพโดยผู้เชี่ยวชาญ
          </span>
          <span className="mt-2 text-sm text-fd-muted-foreground">
            เนื้อหาทั้งหมดผ่านการตรวจสอบจากผู้เชี่ยวชาญด้านภาษาบาลี
          </span>
        </li>
        <li className="mb-2">
          <span className="flex flex-row items-center gap-2 font-medium">
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            ร่วมเป็นส่วนหนึ่งในการพัฒนา
          </span>
          <span className="mt-2 text-sm text-fd-muted-foreground">
            สามารถเข้าไปแก้ไขเนื้อหาที่ไม่ถูกต้องที่ Github ได้โดยตรง
          </span>
        </li>
        <li className="mb-2">
          <span className="flex flex-row items-center gap-2 font-medium">
            <MessageCircleMore className="size-5" />
            รับฟังทุกข้อเสนอแนะ
          </span>
          <span className="mt-2 text-sm text-fd-muted-foreground">
            พร้อมรับฟังความคิดเห็นเพื่อนำไปพัฒนาระบบให้ดียิ่งขึ้น
          </span>
        </li>
        <li lang="th" className="flex flex-row flex-wrap gap-2 mt-auto">
          <Link href="/docs/part-1" className={cn(buttonVariants())}>
            เริ่มเรียน
          </Link>
          <a
            href="/quiz"
            // rel="noreferrer noopener"
            className={cn(
              buttonVariants({
                variant: "outline",
              })
            )}
          >
            ทำแบบทดสอบ
          </a>
        </li>
      </ul>
    </div>
  );
};

export default End;
