import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface QuizPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function QuizPagination({
  currentPage,
  totalPages,
  onPageChange,
}: QuizPaginationProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        <ChevronLeft className="mr-2 h-4 w-4" />
        ก่อนหน้า
      </Button>

      <div className="flex items-center gap-1">
        {Array.from({ length: totalPages }).map((_, index) => (
          <Button
            key={index}
            variant={currentPage === index + 1 ? "default" : "outline"}
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(index + 1)}
          >
            {index + 1}
          </Button>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        ถัดไป
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
