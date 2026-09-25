// "อักขรวิธี", "วจีวิภาค", "วากยสัมพันธ์", "ฉันทลักษณะ"
import { BookA, BookMarked, BookText, BookUp } from "lucide-react";

export const mainMenuData = [
  {
    title: "อักขรวิธี",
    description:
      "ว่าด้วยอักษร จัดเป็น ๒ คือ สมัญญาภิธาน แสดงชื่ออักษร ๑ สนธิ ต่ออักษรที่อยู่ในคำอื่น ให้เนื่องเป็นอันเดียวกัน ๑.",
    href: "/docs/part-1",
    icon: <BookA />,
  },
  {
    title: "วจีวิภาค",
    description:
      "แบ่งคำพูดออกเป็น ๖ ส่วน คือ นาม ๑ อัพยยศัพท์ ๑ สมาส ๑ ตัทธิต ๑ อาขยาต ๑ กฤต ๑.",
    href: "/docs/part-2",
    icon: <BookText />,
  },
  {
    title: "วากยสัมพันธ์",
    description:
      "ว่าด้วยการก และประพันธ์ผูกคำพูดที่แบ่งไว้ในวจีวิภาค ให้เข้าเป็นประโยคอันเดียวกัน.",
    href: "/docs/part-3",
    icon: <BookUp />,
  },
  {
    title: "ฉันทลักษณะ",
    description: "แสดงวิธีแต่งฉันท์ คือคาถาที่เป็นวรรณพฤทธิ์และมาตราพฤทธิ์.",
    href: "/docs/part-4",
    icon: <BookMarked />,
  },
];
