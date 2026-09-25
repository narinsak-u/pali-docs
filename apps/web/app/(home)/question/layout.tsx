import { ReactNode } from "react";

export default function QuestionLayout({ children }: { children: ReactNode }) {
  return (
    <main className="container relative max-w-[1100px] px-2 z-2">
      {children}
    </main>
  );
}
