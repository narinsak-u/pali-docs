import { Button } from "@/components/ui/button";
import { quizTopics } from "@/data/quiz-topic";
import { ArrowRight, LucideIcon, MousePointer } from "lucide-react";
import Break from "../../components/Break";
import End from "../../components/End";
import Hero from "../../components/Hero";

type Props = {
  onStartQuiz: (topicId: string) => Promise<void>;
};

const HomeState = ({ onStartQuiz }: Props) => {
  return (
    <div
      style={{
        background:
          "repeating-linear-gradient(to bottom, transparent, color-mix(in oklab, var(--color-fd-primary) 1%, transparent) 500px, transparent 1000px)",
      }}
    >
      <Hero
        title="บัณฑิตย่อมฝึกตน ฯ"
        description="เตรียมความพร้อมสู่สนามสอบอย่างมั่นใจ ด้วยแบบทดสอบที่รังสรรค์โดยระบบ AI ที่ทันสมัย เพื่อช่วยให้คุณสามารถทบทวนเนื้อหาสำคัญและฝึกฝนทักษะได้อย่างมีประสิทธิภาพก่อนลงสนามจริง เพื่อผลลัพธ์การสอบที่ดีเยี่ยมตามที่คุณมุ่งหวัง! 💯"
      />

      <div
        lang="th"
        className="grid grid-cols-1 border-r md:grid-cols-2 lg:grid-cols-3"
      >
        <div className="col-span-full flex flex-row items-start justify-center border-l border-t p-8 pb-1 text-center">
          <h2 className="bg-fd-primary text-fd-primary-foreground px-1 text-2xl font-semibold">
            เลือกทำแบบทดสอบ
          </h2>
          <MousePointer className="-ml-1 mt-8" />
        </div>
        <div className="col-span-full flex flex-row text-xs text-fd-muted-foreground items-start justify-center border-l  pb-6 text-center">
          พร้อมลุยทุกสนามสอบ ด้วยแบบทดสอบที่คัดสรรมาอย่างเข้มข้น
        </div>

        {quizTopics.map((topic) => (
          <TopicCard
            key={topic.id}
            id={topic.id}
            title={topic.title}
            description={topic.description}
            time={topic.time}
            amount={topic.amount}
            icon={topic.icon}
            onStartQuiz={onStartQuiz}
          />
        ))}
      </div>

      <Break word="อตฺตา หเว ชิตํ เสยฺโย." meaning="ชนะตนนั่นแหละ เป็นดี ฯ" />
      <End />
    </div>
  );
};

export default HomeState;

interface TopicCardProps {
  id: string;
  time: number;
  amount: number;
  title: string;
  description: string;
  // imageUrl?: string;
  icon: LucideIcon;
  onStartQuiz: (topicId: string) => void;
}
const TopicCard = ({
  id,
  title,
  description,
  amount,
  time,
  icon: Icon,
  onStartQuiz,
}: TopicCardProps): React.ReactElement => {
  return (
    <div className="border-l border-t px-6 py-12">
      <div className="mb-4 flex flex-row items-center gap-2 text-fd-muted-foreground">
        <Icon className="size-4" />
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <span className="font-medium">{description}</span>
      <p className="text-xs text-fd-muted-foreground mt-4">
        {` ${amount} ข้อ • ระยะเวลา ${time} นาที`}
      </p>

      <div className="inline-flex items-center mt-4 max-md:mx-auto">
        <Button
          onClick={() => onStartQuiz(id)}
          className="rounded-full"
          size="sm"
        >
          เริ่มทำแบบทดสอบ
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
};
