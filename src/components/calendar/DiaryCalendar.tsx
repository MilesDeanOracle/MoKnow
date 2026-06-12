import { ChevronLeft, ChevronRight, Dot } from "lucide-react";
import type { DiaryDateStatus } from "../../types/models";

interface DiaryCalendarProps {
  month: Date;
  selectedDate: string | null;
  statuses: DiaryDateStatus[];
  loading?: boolean;
  onMonthChange: (month: Date) => void;
  onOpenDate: (date: string) => void;
}

const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthTitle(month: Date): string {
  return `${month.getFullYear()}年${String(month.getMonth() + 1).padStart(2, "0")}月`;
}

function createMonthCells(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<{ date: string; day: number; inMonth: boolean }> = [];

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    cells.push({ date: "", day: 0, inMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = formatDate(new Date(year, monthIndex, day));
    cells.push({ date, day, inMonth: true });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ date: "", day: 0, inMonth: false });
  }

  return cells;
}

export function DiaryCalendar({ month, selectedDate, statuses, loading = false, onMonthChange, onOpenDate }: DiaryCalendarProps) {
  const today = formatDate(new Date());
  const statusByDate = new Map(statuses.map((status) => [status.date, status]));
  const cells = createMonthCells(month);

  const shiftMonth = (offset: number) => {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  };

  return (
    <section className="diary-calendar" aria-label="日历">
      <div className="calendar-header">
        <button className="calendar-nav-btn" type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={14} />
        </button>
        <span className="calendar-title">{monthTitle(month)}</span>
        <button className="calendar-nav-btn" type="button" aria-label="下个月" onClick={() => shiftMonth(1)}>
          <ChevronRight size={14} />
        </button>
        <button className="calendar-today-btn" type="button" onClick={() => onMonthChange(new Date())}>
          今天
        </button>
      </div>

      <div className="calendar-weekdays">
        {weekLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className={`calendar-grid ${loading ? "loading" : ""}`}>
        {cells.map((cell, index) => {
          if (!cell.inMonth) {
            return <span key={`blank-${index}`} className="calendar-day blank" />;
          }

          const status = statusByDate.get(cell.date);
          const isToday = cell.date === today;
          const isSelected = cell.date === selectedDate;

          return (
            <button
              key={cell.date}
              className={`calendar-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${status?.exists ? "written" : ""}`}
              type="button"
              aria-label={`${cell.date}${status?.exists ? " 已写" : " 未写"}`}
              onClick={() => onOpenDate(cell.date)}
            >
              <span>{cell.day}</span>
              {status?.exists ? <Dot size={16} strokeWidth={4} /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
