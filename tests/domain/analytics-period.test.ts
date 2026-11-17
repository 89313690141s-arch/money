import { it, expect } from "vitest";
import { periodForMonth, summarizeExpenses } from "../../src/domain/analytics";
import { emptyState } from "../../src/domain/types";
it("не добавляет ещё не наступившие дни к среднему текущего месяца", () => {
  const period = periodForMonth("2026-11", "2026-11-17");
  expect(period).toEqual({ from: "2026-11-01", to: "2026-11-17" });
  const a = summarizeExpenses(emptyState(), period.from, period.to);
  expect(a.days).toHaveLength(17);
  expect(a.weekday[5].occurrences).toBe(2);
  expect(periodForMonth("2026-10", "2026-11-17").to).toBe("2026-10-31");
  expect(
    summarizeExpenses(emptyState(), "2026-12-01", "2026-11-17").days,
  ).toHaveLength(0);
});
