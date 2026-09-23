import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import ContentNev from "./components/ContentNav";
import Hero from "./components/Hero";
import End from "./components/End";
import Journey from "./components/Journey";
import Highlights from "./components/Hightlights";
import Break from "./components/Break";
import Features from "./components/Features";

const ChatWidget = () => (
  <div className="fixed bottom-10 right-8 z-50">
    <Link href="/question">
      <Button
        size="icon"
        className="rounded-full shadow-lg h-12 w-12 hover:scale-110 transition-transform duration-200 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <MessageCircle className="size-6" />
        <span className="sr-only">Open Chat</span>
      </Button>
    </Link>
  </div>
);

export default function HomePage() {
  return (
    <main className="container relative max-w-[1100px] px-2 py-4 z-2 lg:py-8">
      <div
        style={{
          background:
            "repeating-linear-gradient(to bottom, transparent, color-mix(in oklab, var(--color-fd-primary) 1%, transparent) 500px, transparent 1000px)",
        }}
      >
        <Hero
          mobileTitle="เรียนรู้ภาษาบาลีที่ครอบคลุมทุกระดับ"
          title="เรียนรู้บาลีไวยากรณ์และค้นคว้าได้ด้วยตัวเองอย่างมีประสิทธิภาพ"
          description="แหล่งเรียนรู้ภาษาบาลีที่ครอบคลุมทุกระดับ ด้วยเนื้อหาที่เป็นระบบ
            ครบถ้วน และเข้าใจง่าย ตั้งแต่พื้นฐานจนถึงขั้นสูง
            ค้นคว้าและเรียนรู้ได้ด้วยตัวเองอย่างมีประสิทธิภาพ"
          cta={{
            primaryLabel: "เริ่มต้นเรียนบาลีไวยากรณ์",
            primaryHref: "/docs/part-1",
            secondaryLabel: "ทำแบบทดสอบ",
            secondaryHref: "/quiz",
          }}
        />
        {/* <UwuHero /> */}
        {/* <Feedback />
        <Introduction /> */}

        <ContentNev />

        <Break word="อตฺตานํ ทมยนฺติ ปณฺฑิตา." meaning="บัณฑิตย่อมฝึกตน ฯ" />

        {/* <Why />
        <Contributing /> */}

        <Journey />
        <Break
          word="โยคา เว ชายเต ภูริ."
          meaning="ปัญญา ย่อมเกิดขึ้น เพราะการฝึกฝน ฯ"
        />
        <Features />
        <Highlights />
        <Break
          word="กาลาคตญฺจ น หาเปติ อตฺถํ."
          meaning="คนขยัน ไม่ควรปล่อยให้ประโยชน์ที่มาถึงแล้วผ่านไปโดยเปล่า ฯ"
        />
        <End />
      </div>
      <ChatWidget />
    </main>
  );
}
