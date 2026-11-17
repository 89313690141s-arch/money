import { addDays, monthEnd, type State } from "./types";
import { expenseParts } from "./ledger";
export function periodForMonth(month: string, asOf: string) {
  const last = monthEnd(month + "-01");
  return { from: month + "-01", to: last < asOf ? last : asOf };
}
export function summarizeExpenses(
  s: State,
  from: string,
  to: string,
  filter: "all" | "essential" | "optional" = "all",
) {
  const days: {
    date: string;
    amount: bigint;
    essential: bigint;
    optional: bigint;
    ids: string[];
  }[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({ date, amount: 0n, essential: 0n, optional: 0n, ids: [] });
    if (days.length > 370) break;
  }
  const categories: Record<string, bigint> = {};
  let reducible = 0n,
    principal = 0n,
    uncategorized = 0;
  for (const o of s.operations.filter((o) => o.date >= from && o.date <= to)) {
    if (o.kind === "debtPayment") principal += BigInt(o.principal ?? "0");
    const day = days.find((d) => d.date === o.date);
    for (const p of expenseParts(o)) {
      if (
        (filter === "essential" && !p.essential) ||
        (filter === "optional" && p.essential)
      )
        continue;
      if (day) {
        day.amount += p.value;
        day[p.essential ? "essential" : "optional"] += p.value;
        if (!day.ids.includes(o.id)) day.ids.push(o.id);
      }
      categories[p.categoryId] = (categories[p.categoryId] ?? 0n) + p.value;
      if (!p.categoryId) uncategorized++;
      if (p.reducible) reducible += p.value;
    }
  }
  const weekday = Array.from({ length: 7 }, (_, i) => ({
    label: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i],
    total: 0n,
    occurrences: 0,
    mean: 0n,
    index: i,
  }));
  for (const day of days) {
    const w = weekday[(new Date(day.date + "T12:00:00Z").getUTCDay() + 6) % 7];
    w.total += day.amount;
    w.occurrences++;
  }
  for (const w of weekday)
    w.mean = w.occurrences ? w.total / BigInt(w.occurrences) : 0n;
  const complete = s.accounts
    .filter((a) => a.kind !== "cushion")
    .every((a) =>
      s.coverage.some(
        (c) =>
          c.accountId === a.id && c.complete && c.from <= from && c.to >= to,
      ),
    );
  return {
    days,
    weekday,
    categories,
    total: days.reduce((n, d) => n + d.amount, 0n),
    reducible,
    principal,
    uncategorized,
    preliminary: !complete || uncategorized > 0,
  };
}
