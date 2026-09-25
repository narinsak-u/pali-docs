// import type { Question } from "@/components/quiz/quiz-question";

import {
  Trophy,
  Brain,
  Dumbbell,
  Globe,
  Lightbulb,
  Rocket,
} from "lucide-react";

// Mock data for quiz topics
export const quizTopics = [
  {
    id: "1",
    title: "อักขรวิธี",
    description: "ทดสอบการสะกดคำและหลักการใช้ตัวอักษรในภาษาบาลี",
    keywords: ["สมัญญาภิธาน", "ฐานกรณ์", "สนธิ"],
    amount: 15,
    time: 10,
    icon: Lightbulb,
  },
  {
    id: "2",
    title: "นาม - อัพยยศัพท์",
    description: "วัดความสามารถในการจำแนกชนิดของคำนามและคำที่ไม่เปลี่ยนแปลงรูป",
    keywords: [
      "นาม",
      "การันต์",
      "กติปยศัพท์",
      "สังขยา",
      "สัพพนาม",
      "อัพยยศัพท์",
      "อุปสัค",
      "นิบาต",
      "ปัจจัย",
    ],
    amount: 15,
    time: 10,
    icon: Globe,
  },
  {
    id: "3",
    title: "อาขยาต - กิตก์",
    description:
      "ตรวจสอบความเข้าใจเรื่องกริยาหลักและกริยาที่ทำหน้าที่เหมือนนาม",
    keywords: [
      "อาขยาต",
      "วิภัตติ",
      "กาล",
      "ธาตุ",
      "วาจก",
      "ปัจจัย",
      "กิตก์",
      "นามกิตก์",
      "กิริยากิตก์",
    ],
    amount: 15,
    time: 10,
    icon: Brain,
  },
  {
    id: "4",
    title: "สมาส - ตัทธิต",
    description:
      "ประเมินการวิเคราะห์และการสร้างคำที่เกิดจากการรวมคำและการเติมปัจจัย",
    keywords: [
      "สมาส",
      "กัมมธารยสมาส",
      "ทิคุสมาส",
      "ตัปปุริสสมาส",
      "พหุพพิหิสมาส",
      "ตัทธิต",
      "สามัญญตัทธิต",
      "ภาวตัทธิต",
      "อัพยยตัทธิต",
    ],
    amount: 15,
    time: 10,
    icon: Dumbbell,
  },
  {
    id: "5",
    title: "วากยสัมพันธ์",
    description: "ทดสอบความเข้าใจโครงสร้างและชื่อความสัมพันธ์ของคำในประโยค",
    keywords: ["วากยสัมพันธ์", "แบบสัมพันธ์", "ชื่อเรียกสัมพันธ์"],
    amount: 15,
    time: 10,
    icon: Rocket,
  },
  {
    id: "6",
    title: "รวมทั้งหมด",
    description:
      "แบบทดสอบที่ครอบคลุมเนื้อหาทั้งหมดข้างต้น วัดความรู้ไวยากรณ์บาลีโดยรวม",
    keywords: [
      "สมัญญาภิธาน",
      "ฐานกรณ์",
      "สนธิ",
      "นาม",
      "การันต์",
      "กติปยศัพท์",
      "สังขยา",
      "สัพพนาม",
      "อัพยยศัพท์",
      "อุปสัค",
      "นิบาต",
      "ปัจจัย",
      "อาขยาต",
      "วิภัตติ",
      "กาล",
      "ธาตุ",
      "วาจก",
      "สมาส",
      "ตัทธิต",
      "วากยสัมพันธ์",
      "แบบสัมพันธ์",
      "ชื่อเรียกสัมพันธ์",
    ],
    amount: 30,
    time: 15,
    icon: Trophy,
  },
];

// Mock questions for each topic
// export const generateQuestions = (topicId: string): Question[] => {
//   return Array.from({ length: 15 }).map((_, index) => ({
//     id: `${topicId}-q${index + 1}`,
//     text: `This is a sample question ${index + 1} for the ${topicId} topic?`,
//     options: [
//       {
//         id: `${topicId}-q${index + 1}-a`,
//         text: `Option A for question ${index + 1}`,
//       },
//       {
//         id: `${topicId}-q${index + 1}-b`,
//         text: `Option B for question ${index + 1}`,
//       },
//       {
//         id: `${topicId}-q${index + 1}-c`,
//         text: `Option C for question ${index + 1}`,
//       },
//       {
//         id: `${topicId}-q${index + 1}-d`,
//         text: `Option D for question ${index + 1}`,
//       },
//     ],
//     correctOptionId: `${topicId}-q${index + 1}-a`, // For simplicity, A is always correct
//   }));
// };

export const quizTopicsById = new Map(quizTopics.map((t) => [t.id, t]));

export const getTopicTitle = (selectedTopic: string | null) => {
  return quizTopicsById.get(selectedTopic ?? "")?.title || "Quiz";
};

export const suggestedQuestions = [
  "คำว่า 'ตตฺราภิรติมิจฺเฉยฺย' จัดเป็นสนธิอะไร? วิเคราะห์อย่างไร?",
  "สมาสในภาษาบาลีมีกี่ประเภท แต่ละประเภทมีลักษณะและการใช้งานอย่างไร?",
  "ธาตุในภาษาบาลีคืออะไร และมีความสำคัญต่อการสร้างคำอย่างไร?",
];
