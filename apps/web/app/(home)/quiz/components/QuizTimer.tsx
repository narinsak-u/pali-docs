"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface QuizTimerProps {
  duration: number; // in seconds
  onTimeUp: () => void;
}

export function QuizTimer({ duration = 10, onTimeUp }: QuizTimerProps) {
  const [timeLeft, setTimeLeft] = useState(duration);

  useEffect(() => {
    if (timeLeft <= 0) {
      onTimeUp();
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [timeLeft, onTimeUp]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const percentage = (timeLeft / duration) * 100;

  // Add visual urgency when time is running low (less than 20% of time remaining)
  const isTimeRunningLow = percentage < 20;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div
          className={`flex items-center gap-2 text-sm font-medium ${
            isTimeRunningLow ? "text-red-500 animate-pulse" : ""
          }`}
        >
          <Clock
            className={`h-4 w-4 ${isTimeRunningLow ? "text-red-500" : ""}`}
          />
          <span>
            {minutes.toString().padStart(2, "0")}:
            {seconds.toString().padStart(2, "0")}
          </span>
        </div>
        <span className="text-xs text-muted-foreground pl-1">เวลาคงเหลือ</span>
      </div>
      <Progress
        value={percentage}
        className={`h-2 ${isTimeRunningLow ? "bg-red-200" : ""}`}
        // indicatorClassName={isTimeRunningLow ? "bg-red-500" : undefined}
      />
    </div>
  );
}
