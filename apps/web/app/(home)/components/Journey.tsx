import Image from "next/image";
import { Step, Steps } from "fumadocs-ui/components/steps";

const Journey = () => {
  return (
    <div
      lang="th"
      className="flex flex-col gap-4 border-x border-t p-8 md:px-12"
    >
      <div className="text-start">
        {/* <p
          lang="en"
          className="px-2 py-1 text-sm font-mono bg-fd-primary text-fd-primary-foreground font-bold w-fit mb-4"
        >
          Designed with Love
        </p> */}
        <h2 className="text-3xl font-semibold mb-4">เส้นทางมหาเปรียญฯ</h2>
        <p className="text-fd-muted-foreground font-semibold mb-6">
          การศึกษาเปรียญธรรมเป็นการเรียนบาลีเพื่อทำความเข้าใจพระธรรมวินัย
          โดยแบ่งเป็น ๙ ประโยค เปรียญตรี โท เอก
          เป็นการจัดกลุ่มประโยคเพื่อความสะดวกในการเรียก
          โดยแต่ละกลุ่มจะมีการเรียนเนื้อหาที่แตกต่างกันไป ดังนี้ ฯ
        </p>
      </div>

      <div className="md:flex-row flex flex-col gap-4">
        <div className="mb-5">
          <Steps>
            <Step>
              <div className="">
                <h2 className="text-lg font-semibold">
                  เปรียญตรี (เปรียญธรรม ๑-๒ และ ๓ ประโยค):
                </h2>
                <p className="py-2 text-fd-muted-foreground font-semibold leading-relaxed">
                  เเป็นระดับพื้นฐานที่มุ่งเน้นการปูพื้นฐานไวยากรณ์บาลีอย่างเข้มข้น
                  และการแปลธรรมบทเบื้องต้น ตำราเรียนได้แก่ อักขรวิธี, วจีวิภาค,
                  วากยสัมพันธ์ และธรรมบท ภาค ๑-๔
                </p>
              </div>
            </Step>

            <Step>
              <div className="">
                <h2 className="text-lg font-semibold">
                  เปรียญโท (เปรียญธรรม ๔, ๕ และ ๖ ประโยค):
                </h2>
                <p className="py-2 leading-relaxed text-fd-muted-foreground font-semibold">
                  ผู้เรียนจะมีความสามารถในการแปลบาลีได้ดีขึ้น
                  และเริ่มแปลคัมภีร์อรรถกถา รวมถึงศึกษาพระวินัยปิฎกอย่างลึกซึ้ง
                  ตำราเรียนได้แก่ ธรรมบท ภาค ๕-๘, มังคลัตถทีปนี, สมันตปาสาทิกา
                </p>
              </div>
            </Step>
            <Step>
              <div className="">
                <h2 className="text-lg font-semibold">
                  เปรียญเอก (เปรียญธรรม ๗, ๘ และ ๙ ประโยค):
                </h2>
                <p className="py-2 leading-relaxed text-fd-muted-foreground font-semibold">
                  เป็นระดับสูงสุดของการศึกษาบาลี
                  ผู้ที่สอบผ่านจะมีความรู้ความเชี่ยวชาญในพระไตรปิฎกอย่างแตกฉาน
                  และมีความสามารถในการค้นคว้าวิจัยพระธรรมวินัย ตำราเรียนได้แก่
                  สมันตปาสาทิกา, ปกรณวิเสสวิสุทธิมรรค, อภิธัมมัตถสังคหะ,
                  ฉันทลักษณะ และแต่งไทย
                </p>
              </div>
            </Step>
          </Steps>
        </div>
        <div className="h-full m-auto">
          <Image
            src="/items.png"
            alt="image"
            width={1000}
            height={1000}
            loading="lazy"
          />
        </div>
      </div>

      <p className="text-fd-muted-foreground font-semibold mb-6">
        <span className="text-foreground">
          พื้นฐานไวยากรณ์ เป็นดั่งรากฐานของการศึกษาบาลี
        </span>
        <br />
        เปรียญธรรมทุกระดับจำเป็นต้องมีพื้นฐานไวยากรณ์เปรียบดังรากฐานของต้นไม้
        เพื่อให้สามารถต่อยอดและทำความเข้าใจพระธรรมวินัยได้อย่างลึกซึ้ง ฯ
      </p>
    </div>
  );
};

export default Journey;
