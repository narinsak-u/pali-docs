import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Props = {};

const Disclaimer = (props: Props) => {
  return (
    <div className="border px-6 py-12">
      <div className="grid w-full items-start gap-4">
        <Alert variant="default">
          <AlertCircleIcon />
          <AlertTitle>คำเตือน (Disclaimer)</AlertTitle>
          <AlertDescription className="mt-3">
            <p>
              แบบทดสอบนี้จัดทำขึ้นโดยระบบปัญญาประดิษฐ์ (AI)
              ผู้ใช้ควรใช้วิจารณญาณในการประเมินข้อมูล
              และโปรดระมัดระวังต่อความคาดเคลื่อนหรือข้อผิดพลาดที่อาจเกิดขึ้น
              ซึ่งอาจส่งผลให้เกิดความเข้าใจคลาดเคลื่อน เพื่อความถูกต้องแม่นยำ
              แนะนำให้ตรวจสอบข้อมูลร่วมกับแหล่งอ้างอิงที่เชื่อถือได้เสมอ.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
};

export default Disclaimer;
