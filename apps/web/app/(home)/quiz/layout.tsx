import Hero from "../components/Hero";
import End from "../components/End";
import Break from "../components/Break";
import { ReactNode } from "react";

export default function QuizLayout({ children }: { children: ReactNode }) {
  return (
    <main className="container relative max-w-[1100px] px-2 py-4 z-2 lg:py-8">
      {children}
      {/* <div
        style={{
          background:
            "repeating-linear-gradient(to bottom, transparent, color-mix(in oklab, var(--color-fd-primary) 1%, transparent) 500px, transparent 1000px)",
        }}
      >
        <Hero
          title="บัณฑิตย่อมฝึกตน ฯ"
          description="เตรียมความพร้อมสู่สนามสอบอย่างมั่นใจ ด้วยแบบทดสอบที่รังสรรค์โดยระบบ AI ที่ทันสมัย เพื่อช่วยให้คุณสามารถทบทวนเนื้อหาสำคัญและฝึกฝนทักษะได้อย่างมีประสิทธิภาพก่อนลงสนามจริง เพื่อผลลัพธ์การสอบที่ดีเยี่ยมตามที่คุณมุ่งหวัง! 💯"
        />
        {children}

        <Break word="อตฺตา หเว ชิตํ เสยฺโย." meaning="ชนะตนนั่นแหละ เป็นดี ฯ" />
        <End />
      </div> */}
    </main>
  );
}
