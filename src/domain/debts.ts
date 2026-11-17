import { balanceAt } from "./ledger";
import { addDays, monthEnd, type Debt, type State } from "./types";
export type Requirement = {
  id: string;
  name: string;
  dueDate: string;
  amount: bigint;
  estimated?: boolean;
  reserveOnly?: boolean;
};
export function hasOutstandingDebt(s: State, asOf: string) {
  return (
    s.debts.some((d) => debtBalance(s, d, asOf) > 0n) ||
    s.accounts.some(
      (a) => a.kind === "credit" && balanceAt(a, s.operations, asOf) < 0n,
    )
  );
}
export function debtBalance(s: State, d: Debt, asOf: string) {
  if (d.kind === "card") {
    const a = s.accounts.find((a) => a.id === d.accountId);
    return a
      ? -balanceAt(a, s.operations, asOf) > 0n
        ? -balanceAt(a, s.operations, asOf)
        : 0n
      : BigInt(d.opening);
  }
  const paid = s.operations
    .filter(
      (o) =>
        o.kind === "debtPayment" &&
        o.debtId === d.id &&
        o.date > d.openingDate &&
        o.date <= asOf,
    )
    .reduce(
      (n, o) =>
        n + BigInt(o.principal ?? (d.kind === "personal" ? o.amount : "0")),
      0n,
    );
  return BigInt(d.opening) - paid > 0n ? BigInt(d.opening) - paid : 0n;
}
export function debtSchedule(d: Debt, asOf: string) {
  if (d.schedule?.length)
    return [...d.schedule].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const end = monthEnd(asOf) > addDays(asOf, 30)
    ? monthEnd(asOf)
    : addDays(asOf, 30);
  const dates = [{ dueDate: d.dueDate, amount: d.payment }];
  const anchorDay = Number(d.dueDate.slice(-2));
  let month = d.dueDate.slice(0, 7);
  while (true) {
    const next = new Date(month + "-01T12:00:00Z");
    next.setUTCMonth(next.getUTCMonth() + 1);
    month = next.toISOString().slice(0, 7);
    const dueDate = month + "-" + Math.min(
      anchorDay,
      Number(monthEnd(month + "-01").slice(-2)),
    ).toString().padStart(2, "0");
    if (dueDate > end) break;
    dates.push({ dueDate, amount: d.payment });
  }
  return dates;
}
export function debtRequirements(
  s: State,
  d: Debt,
  asOf: string,
): Requirement[] {
  if (debtBalance(s, d, asOf) === 0n) return [];
  if (d.kind === "card") {
    const paid = s.operations
      .filter(
        (o) =>
          o.kind === "transfer" &&
          o.toAccountId === d.accountId &&
          o.date > d.verifiedDate &&
          o.date <= asOf,
      )
      .reduce((n, o) => n + BigInt(o.amount), 0n);
    const max = (a: bigint, b: bigint) => (a > b ? a : b);
    // The account ledger is the single source of principal. A bank reconciliation
    // changes the dates/minimum, never adds purchases to that balance a second time.
    const total = debtBalance(s, d, asOf);
    const cap = (n: bigint) => (n < total ? n : total);
    const minimum = cap(max(BigInt(d.minimum) - paid, 0n));
    const grace = cap(max(BigInt(d.graceAmount) - paid, 0n));
    const bankDue = max(minimum, grace);
    return [
      {
        id: d.id + ":min",
        name: d.name + " · минимальный платёж",
        dueDate: d.minimumDate,
        amount:
          d.minimumDate <= d.graceDate ? minimum : max(minimum - grace, 0n),
      },
      {
        id: d.id + ":grace",
        name: d.name + " · льготный период",
        dueDate: d.graceDate,
        amount: d.minimumDate <= d.graceDate ? max(grace - minimum, 0n) : grace,
      },
      {
        id: d.id + ":future",
        name: d.name + " · покупки вне текущего платежа · резерв",
        dueDate: addDays(asOf, 31),
        amount: total - bankDue,
        estimated: true,
        reserveOnly: true,
      },
    ].filter((r) => r.amount > 0n);
  }
  const schedule = debtSchedule(d, asOf).map((p) => ({
    ...p,
    remaining: BigInt(p.amount),
  }));
  const payments = s.operations
    .filter((o) => o.kind === "debtPayment" && o.debtId === d.id &&
      o.date > d.openingDate && o.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const payment of payments) {
    let remaining = BigInt(payment.amount);
    // Explicit choices stay attached to their instalment. Unassigned bank rows
    // pay the oldest unpaid instalments first, including late and partial sums.
    for (const due of schedule) {
      if (payment.debtDueDate && payment.debtDueDate !== due.dueDate) continue;
      // Unassigned early principal does not replace future bank instalments.
      if (!payment.debtDueDate && due.dueDate > payment.date) continue;
      const used = remaining < due.remaining ? remaining : due.remaining;
      due.remaining -= used;
      remaining -= used;
      if (remaining === 0n) break;
    }
  }
  let personalRemaining = debtBalance(s, d, asOf);
  return schedule.flatMap((payment) => {
    const amount = d.kind === "personal" && payment.remaining > personalRemaining
      ? personalRemaining : payment.remaining;
    if (d.kind === "personal") personalRemaining -= amount;
    return amount > 0n ? [{
      id: d.id + ":" + payment.dueDate,
      name: d.name,
      dueDate: payment.dueDate,
      amount,
      ...(!d.schedule?.length ? { estimated: true } : {}),
    }] : [];
  });
}
