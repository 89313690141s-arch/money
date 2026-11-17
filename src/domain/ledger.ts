import {
  stateSchema,
  type Account,
  type Operation,
  type State,
  type Part,
} from "./types";
const partKey = (p: Part) => JSON.stringify([p.categoryId, p.essential]);
export function refundParts(
  s: State,
  originalId: string,
  amount: string,
  excludeId?: string,
): Part[] {
  const original = s.operations.find(
    (o) => o.id === originalId && o.kind === "expense",
  );
  if (!original) throw Error("Выбери исходную покупку для возврата");
  const groups = new Map<string, { part: Part; remaining: bigint }>();
  for (const part of original.parts) {
    const key = partKey(part),
      group = groups.get(key);
    if (group) group.remaining += BigInt(part.amount);
    else groups.set(key, { part, remaining: BigInt(part.amount) });
  }
  for (const refund of s.operations.filter(
    (o) =>
      o.kind === "refund" && o.refundOf === originalId && o.id !== excludeId,
  ))
    for (const p of refund.parts) {
      const group = groups.get(partKey(p));
      if (group) group.remaining -= BigInt(p.amount);
    }
  const total = [...groups.values()].reduce((n, g) => n + g.remaining, 0n),
    requested = BigInt(amount);
  if (requested <= 0n || requested > total)
    throw Error("Возврат превышает невозвращённую сумму покупки");
  const shares = [...groups.values()]
    .filter((g) => g.remaining > 0n)
    .map((g) => ({
      ...g,
      amount: (requested * g.remaining) / total,
      remainder: (requested * g.remaining) % total,
    }));
  let extra = requested - shares.reduce((n, g) => n + g.amount, 0n);
  for (const share of [...shares].sort((a, b) =>
    a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (extra === 0n) break;
    share.amount++;
    extra--;
  }
  return shares
    .filter((g) => g.amount > 0n)
    .map((g) => ({ ...g.part, amount: g.amount.toString() }));
}
export function balanceAt(
  account: Account,
  entries: Operation[],
  date: string,
): bigint {
  let result = BigInt(account.opening);
  for (const op of entries) {
    if (op.date <= account.openingDate || op.date > date) continue;
    const amount = BigInt(op.amount);
    if (op.toAccountId === account.id && op.kind === "transfer")
      result += amount;
    if (op.accountId === account.id)
      result += op.kind === "income" || op.kind === "refund" ? amount : -amount;
  }
  return result;
}
export function expenseParts(op: Operation) {
  if (op.kind === "expense")
    return op.parts.map((p) => ({ ...p, value: BigInt(p.amount) }));
  if (op.kind === "refund")
    return op.parts.map((p) => ({ ...p, value: -BigInt(p.amount) }));
  if (op.kind === "debtPayment" && op.interest && BigInt(op.interest) > 0n)
    return [
      {
        categoryId: "interest",
        amount: op.interest,
        essential: true,
        reducible: false,
        value: BigInt(op.interest),
      },
    ];
  return [];
}
export function validateOperation(s: State, op: Operation) {
  const account = s.accounts.find((a) => a.id === op.accountId);
  if (!account) throw new Error("Счёт не найден");
  if (
    op.kind === "transfer" &&
    (!s.accounts.some((a) => a.id === op.toAccountId) ||
      op.accountId === op.toAccountId)
  )
    throw new Error("Выбери другой счёт получателя");
  if (op.kind === "income" && account.kind === "credit")
    throw new Error("Поступление на кредитку оформи переводом");
  if (op.planItemId) {
    const plan = s.plans.find((p) => p.id === op.planItemId && p.dueDate);
    if (
      !plan ||
      !["expense", "refund"].includes(op.kind) ||
      !op.parts.some((p) => p.categoryId === plan.categoryId && p.essential)
    )
      throw Error(
        "Выбери фиксированный платёж соответствующей обязательной категории",
      );
  }
  if (["expense", "refund"].includes(op.kind)) {
    if (
      op.parts.reduce((n, p) => n + BigInt(p.amount), 0n) !== BigInt(op.amount)
    )
      throw new Error("Сумма категорий должна совпадать с суммой операции");
    if (
      op.parts.some(
        (p) => p.categoryId && !s.categories.some((c) => c.id === p.categoryId),
      )
    )
      throw new Error("Категория не найдена");
  }
  if (op.kind === "refund") {
    const original = s.operations.find(
      (o) => o.id === op.refundOf && o.kind === "expense",
    );
    if (!original) throw new Error("Выбери исходную покупку для возврата");
    if (op.date < original.date)
      throw new Error("Возврат не может быть раньше покупки");
    const returned = s.operations
      .filter(
        (o) =>
          o.kind === "refund" && o.refundOf === original.id && o.id !== op.id,
      )
      .reduce((n, o) => n + BigInt(o.amount), 0n);
    if (returned + BigInt(op.amount) > BigInt(original.amount))
      throw new Error("Возвраты превышают сумму покупки");
    const limits = new Map<string, bigint>();
    for (const p of original.parts)
      limits.set(partKey(p), (limits.get(partKey(p)) ?? 0n) + BigInt(p.amount));
    for (const r of [
      ...s.operations.filter(
        (o) =>
          o.kind === "refund" && o.refundOf === original.id && o.id !== op.id,
      ),
      op,
    ])
      for (const p of r.parts) {
        const key = partKey(p);
        if (!limits.has(key))
          throw Error(
            "Категории возврата должны совпадать с исходной покупкой",
          );
        limits.set(key, limits.get(key)! - BigInt(p.amount));
        if (limits.get(key)! < 0n)
          throw Error("Возвраты превышают сумму исходной категории");
      }
    if (op.planItemId && op.planItemId !== original.planItemId)
      throw Error("Возврат должен быть связан с платежом исходной покупки");
  }
  if (op.kind === "debtPayment") {
    const debt = s.debts.find((d) => d.id === op.debtId);
    if (!debt || debt.kind === "card")
      throw new Error("Погашение карты оформи переводом на её счёт");
    if ((op.principal === undefined) !== (op.interest === undefined))
      throw new Error("Укажи и тело платежа, и проценты");
    if (
      op.principal !== undefined &&
      (BigInt(op.principal) < 0n ||
        BigInt(op.interest!) < 0n ||
        BigInt(op.principal) + BigInt(op.interest!) !== BigInt(op.amount))
    )
      throw new Error("Тело и проценты должны совпадать с платежом");
  }
}
export function validateState(s: State) {
  stateSchema.parse(s);
  for (const key of [
    "accounts",
    "categories",
    "operations",
    "plans",
    "debts",
    "allocations",
    "rules",
  ] as const) {
    const ids = s[key].map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      throw new Error("Повторяющиеся записи");
  }
  for (const op of s.operations) validateOperation(s, op);
  for (const p of s.plans)
    if (
      !s.categories.some((c) => c.id === p.categoryId) ||
      (p.dueDate && !p.dueDate.startsWith(p.month))
    )
      throw new Error("Проверь категорию и месяц платежа");
  for (const debt of s.debts) {
    for (const n of [debt.payment, debt.minimum, debt.graceAmount])
      if (BigInt(n) < 0n) throw new Error("Платёж не может быть отрицательным");
    if (
      debt.kind === "card" &&
      !s.accounts.some((a) => a.id === debt.accountId && a.kind === "credit")
    )
      throw new Error("Выбери кредитный счёт");
  }
  const cardAccounts = s.debts
    .filter((d) => d.kind === "card" && !d.complete)
    .map((d) => d.accountId);
  if (new Set(cardAccounts).size !== cardAccounts.length)
    throw Error("Для кредитного счёта уже настроен долг");
  for (const d of s.debts)
    if (
      d.schedule &&
      new Set(d.schedule.map((p) => p.dueDate)).size !== d.schedule.length
    )
      throw Error("В графике повторяются даты платежей");
  for (const rule of s.rules)
    if (!s.categories.some((c) => c.id === rule.categoryId))
      throw Error("Категория правила не найдена");
  for (const coverage of s.coverage)
    if (
      !s.accounts.some((a) => a.id === coverage.accountId) ||
      coverage.from > coverage.to
    )
      throw Error("Проверь счёт и период покрытия");
  for (const a of s.allocations)
    if (
      !s.operations.some((o) => o.id === a.incomeId && o.kind === "income") ||
      BigInt(a.amount) < 0n
    )
      throw new Error("Распределение без дохода");
}
