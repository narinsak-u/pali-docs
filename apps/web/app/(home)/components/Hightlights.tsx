import {
  KeyboardIcon,
  LayoutIcon,
  LucideIcon,
  MousePointer,
  PersonStandingIcon,
  RocketIcon,
  SearchIcon,
  TimerIcon,
} from "lucide-react";
import { ReactNode } from "react";

const Highlights = () => {
  return (
    <div
      lang="th"
      className="grid grid-cols-1 border-r md:grid-cols-2 lg:grid-cols-3"
    >
      <div className="col-span-full flex flex-row items-start justify-center border-l border-t p-8 pb-2 text-center">
        <h2 className="bg-fd-primary text-fd-primary-foreground px-1 text-2xl font-semibold">
          วัตถุประสงค์
        </h2>
        <MousePointer className="-ml-1 mt-8" />
      </div>
      <Highlight
        icon={TimerIcon}
        heading="หลักสูตรครบถ้วน เรียนง่าย เข้าใจเร็ว"
      >
        เริ่มต้นจากหลักไวยากรณ์พื้นฐานที่จำเป็น เช่น คำนาม กริยา
        และโครงสร้างประโยค เพื่อปูพื้นฐานที่แข็งแรงสู่การเรียนรู้ขั้นสูง
      </Highlight>
      <Highlight icon={LayoutIcon} heading="ทบทวนบทเรียนได้ตามต้องการ">
        เสริมความเข้าใจด้วยแบบฝึกหัดและตัวอย่างที่หลากหลาย
        เพื่อทบทวนเนื้อหาอย่างละเอียดและแม่นยำ
      </Highlight>
      <Highlight icon={RocketIcon} heading="สื่อการเรียนรู้ที่หลากหลาย">
        พัฒนาสื่อการเรียนการสอนบาลีในรูปแบบต่าง ๆ
        เพื่อให้ทุกคนเรียนรู้ได้อย่างสะดวกและมีประสิทธิภาพ.
      </Highlight>
      <Highlight icon={SearchIcon} heading="อนุรักษ์และสืบสาน">
        เปิดโอกาสให้ผู้สนใจได้มีส่วนร่วมในการสืบสานและส่งเสริมการเรียนรู้ภาษาบาลี
        ซึ่งเป็นรากฐานสำคัญของพระพุทธศาสนา
      </Highlight>
      <Highlight icon={KeyboardIcon} heading="แบบทดสอบด้วย AI">
        ฝึกฝนทักษะการทำข้อสอบบาลีด้วยชุดข้อสอบที่หลากหลายจาก AI
        เพื่อความคุ้นเคยและการเตรียมตัวที่ดี
      </Highlight>
      <Highlight icon={PersonStandingIcon} heading="ผู้ช่วย AI ส่วนตัว">
        มีผู้ช่วย AI ที่พร้อมตอบคำถามและให้คำแนะนำในการเรียนบาลีได้ตลอดเวลา
        ทำให้การเรียนรู้ของคุณราบรื่นและต่อเนื่อง
      </Highlight>
    </div>
  );
};

export default Highlights;

const Highlight = ({
  icon: Icon,
  heading,
  children,
}: {
  icon: LucideIcon;
  heading: ReactNode;
  children: ReactNode;
}): React.ReactElement => {
  return (
    <div className="border-l border-t px-6 py-12">
      <div className="mb-4 flex flex-row items-center gap-2 text-fd-muted-foreground">
        <Icon className="size-4" />
        <h2 className="text-sm font-medium">{heading}</h2>
      </div>
      <span className="font-medium">{children}</span>
    </div>
  );
};
