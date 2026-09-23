import { contentData } from "@/data/contentData";
import { ArrowRight } from "lucide-react";

const ContentNev = () => {
  return (
    <div
      lang="th"
      className="flex flex-col gap-4 py-4 md:py-14 border-x border-t md:px-12"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {contentData.contents.map((content, index) => (
          <div key={index} className="border flex flex-col p-8 gap-2">
            <h2 className="text-2xl font-semibold pb-2">{content.partname}</h2>
            <div className="flex flex-col gap-1 text-fd-muted-foreground">
              {content.items.map((item, index) => (
                <div
                  key={index}
                  className="flex font-semibold flex-col transition-all hover:text-primary divide-gray-700 gap-2 divide-y-[1px] text-md"
                >
                  <a
                    href={item.href}
                    className="flex justify-between items-center text-link"
                  >
                    <span>{item.name}</span>
                    <ArrowRight size={12} />
                  </a>
                </div>
              ))}

              <div>
                <a
                  href={content.href}
                  className="text-lg transition-all hover:text-primary py-3 font-semibold flex justify-between items-center text-link"
                >
                  <span>อ่านทั้งหมด</span>
                  <ArrowRight size={15} />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ContentNev;
