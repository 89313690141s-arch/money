import { addDays, monthEnd, type State } from "./types";
import { balanceAt, expenseParts } from "./ledger";
import {
  debtRequirements,
  hasOutstandingDebt,
  type Requirement,
} from "./debts";
const max = (a: bigint, b: bigint) => (a > b ? a : b);
export function buildBudget(s: State, asOf: string) {
  const end = monthEnd(asOf),
    horizonEnd = end > addDays(asOf, 30) ? end : addDays(asOf, 30);
  const cash = s.accounts
    .filter((a) => ["debit", "cash"].includes(a.kind))
    .reduce((n, a) => n + balanceAt(a, s.operations, asOf), 0n);
  const cushion = s.accounts
    .filter((a) => a.kind === "cushion")
    .reduce((n, a) => n + balanceAt(a, s.operations, asOf), 0n);
  const requirements: Requirement[] = [];
  for (const p of s.plans) {
    const c = s.categories.find((c) => c.id === p.categoryId);
    if (!c?.essential) continue;
    const last = monthEnd(p.month + "-01");
    if (p.month > horizonEnd.slice(0, 7)) continue;
    if (!p.dueDate && last < asOf) continue;
    const spent = s.operations
      .filter(
        (o) =>
          o.date <= asOf &&
          (p.dueDate
            ? (o.planItemId ??
                s.operations.find((original) => original.id === o.refundOf)
                  ?.planItemId) === p.id
            : o.date.startsWith(p.month)),
      )
      .flatMap(expenseParts)
      .filter((x) => x.categoryId === p.categoryId && x.essential)
      .reduce((n, p) => n + p.value, 0n);
    let remaining = max(BigInt(p.amount) - spent, 0n);
    if (p.dueDate && p.dueDate > horizonEnd) continue;
    if (!p.dueDate && last > horizonEnd) {
      const days = Number(horizonEnd.slice(-2));
      remaining = (remaining * BigInt(days)) / BigInt(Number(last.slice(-2)));
    }
    if (remaining > 0n)
      requirements.push({
        id: p.id,
        name: c.name,
        dueDate: p.dueDate ?? last,
        amount: remaining,
        estimated: !p.dueDate,
      });
  }
  const nextMonth = horizonEnd.slice(0, 7),
    currentMonth = asOf.slice(0, 7);
  if (nextMonth !== currentMonth) {
    for (const p of s.plans.filter(
      (p) => p.month === currentMonth && !p.dueDate,
    )) {
      if (
        s.plans.some(
          (x) => x.month === nextMonth && x.categoryId === p.categoryId,
        )
      )
        continue;
      const c = s.categories.find((c) => c.id === p.categoryId);
      if (!c?.essential) continue;
      const amount =
        (BigInt(p.amount) * BigInt(Number(horizonEnd.slice(-2)))) /
        BigInt(Number(monthEnd(horizonEnd).slice(-2)));
      requirements.push({
        id: p.id + ":estimate",
        name: c.name + " · следующий месяц",
        dueDate: horizonEnd,
        amount,
        estimated: true,
      });
    }
  }
  for (const d of s.debts.filter((d) => d.kind !== "card"))
    requirements.push(
      ...debtRequirements(s, d, asOf).filter((r) => r.dueDate <= horizonEnd),
    );
  // Every credit account reserves its full outstanding balance, even before its
  // bank payment dates enter the planning horizon or a debt record is configured.
  for (const a of s.accounts.filter((a) => a.kind === "credit")) {
    const d = s.debts.find(
      (d) => d.kind === "card" && d.accountId === a.id && !d.complete,
    );
    if (d) requirements.push(...debtRequirements(s, d, asOf));
    else {
      const outstanding = max(-balanceAt(a, s.operations, asOf), 0n);
      if (outstanding > 0n)
        requirements.push({
          id: a.id + ":credit",
          name: a.name + " · задолженность",
          dueDate: asOf,
          amount: outstanding,
        });
    }
  }
  const obligations = requirements.reduce((n, r) => n + r.amount, 0n);
  // A transfer can fulfil each kopeck once. Transfers already present at
  // confirmation, and movements within the cushion, cannot consume a new reserve.
  const pending = s.allocations
    .filter((a) => a.createdDate <= asOf)
    .map((a) => ({ allocation: a, remaining: BigInt(a.amount) }));
  const transfers = s.operations
    .filter(
      (o) =>
        o.kind === "transfer" &&
        o.date <= asOf &&
        s.accounts.some(
          (a) =>
            a.id === o.accountId &&
            ["debit", "cash"].includes(a.kind) &&
            o.date > a.openingDate,
        ) &&
        s.accounts.some(
          (a) =>
            a.id === o.toAccountId &&
            a.kind === "cushion" &&
            o.date > a.openingDate,
        ),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const transfer of transfers) {
    let remaining = BigInt(transfer.amount);
    for (const item of pending) {
      const a = item.allocation;
      if (
        transfer.date < a.createdDate ||
        a.priorTransferIds?.includes(transfer.id) ||
        (!a.priorTransferIds && transfer.date === a.createdDate)
      )
        continue;
      const used = remaining < item.remaining ? remaining : item.remaining;
      item.remaining -= used;
      remaining -= used;
      if (remaining === 0n) break;
    }
  }
  const cushionReserved = pending.reduce((n, a) => n + a.remaining, 0n),
    reserved = obligations + cushionReserved;
  const available = cash - reserved;
  const essentialMonthly = s.plans
    .filter(
      (p) =>
        p.month === currentMonth &&
        s.categories.some((c) => c.id === p.categoryId && c.essential),
    )
    .reduce((n, p) => n + BigInt(p.amount), 0n);
  const preliminary =
    s.accounts.some((a) => a.verifiedDate < asOf) ||
    s.operations.some(
      (o) =>
        ["expense", "refund"].includes(o.kind) &&
        o.parts.some((p) => !p.categoryId),
    ) ||
    s.accounts
      .filter((a) => a.kind !== "cushion")
      .some(
        (a) =>
          !s.coverage.some(
            (c) =>
              c.accountId === a.id &&
              c.complete &&
              c.from <= currentMonth + "-01" &&
              c.to >= asOf,
          ),
      );
  return {
    cash,
    cushion,
    obligations,
    cushionReserved,
    reserved,
    available,
    deficit: max(-available, 0n),
    horizonEnd,
    requirements: requirements.sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate),
    ),
    essentialMonthly,
    preliminary,
  };
}
export function proposeAllocation(s: State, incomeId: string, asOf: string) {
  const op = s.operations.find((o) => o.id === incomeId && o.kind === "income");
  if (!op) throw new Error("Поступление не найдено");
  const b = buildBudget(s, asOf);
  const rate =
    s.settings.higherRateConfirmed && !hasOutstandingDebt(s, asOf)
      ? s.settings.afterDebtBps
      : s.settings.cushionBps;
  const desired = (BigInt(op.amount) * BigInt(rate)) / 10000n;
  const free = max(b.available, 0n);
  return {
    incomeId,
    amount: desired < free ? desired : free,
    desired,
    deficit: b.deficit,
    alreadyConfirmed: s.allocations.some((a) => a.incomeId === incomeId),
  };
}
