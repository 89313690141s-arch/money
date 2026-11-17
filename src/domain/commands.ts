import { z } from "zod";
import {
  accountSchema,
  categorySchema,
  operationSchema,
  planItemSchema,
  debtSchema,
  settingsSchema,
  dateSchema,
  moneySchema,
  today,
  type State,
} from "./types";
import { balanceAt, validateState } from "./ledger";
import { debtBalance, hasOutstandingDebt } from "./debts";
import { buildBudget, proposeAllocation } from "./budget";
const uid = z.string().min(1).max(100);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account"), value: accountSchema }),
  z.object({ type: z.literal("category"), value: categorySchema }),
  z.object({ type: z.literal("operation"), value: operationSchema }),
  z.object({ type: z.literal("plan"), value: planItemSchema }),
  z.object({ type: z.literal("debt"), value: debtSchema }),
  z.object({ type: z.literal("settings"), value: settingsSchema }),
  z.object({
    type: z.literal("remove"),
    entity: z.enum([
      "accounts",
      "categories",
      "operations",
      "plans",
      "debts",
      "rules",
    ]),
    id: uid,
  }),
  z.object({
    type: z.literal("allocate"),
    incomeId: uid,
    id: uid,
    amount: moneySchema.optional(),
  }),
  z.object({ type: z.literal("cancelAllocation"), id: uid }),
  z.object({
    type: z.literal("copyPlan"),
    from: z.string().regex(/^\d{4}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}$/),
  }),
  z.object({
    type: z.literal("rule"),
    id: uid,
    contains: z.string().trim().min(1).max(120),
    categoryId: uid,
  }),
  z
    .object({
      type: z.literal("import"),
      batchId: uid,
      accountId: uid,
      operations: z.array(operationSchema).max(10000),
      from: dateSchema,
      to: dateSchema,
      complete: z.boolean(),
    })
    .refine((c) => c.from <= c.to, "Проверь период импорта"),
  z
    .object({
      type: z.literal("coverage"),
      accountId: uid,
      from: dateSchema,
      to: dateSchema,
      complete: z.boolean(),
    })
    .refine((c) => c.from <= c.to, "Проверь период покрытия"),
]);
export type Command = z.infer<typeof commandSchema>;
export function applyCommand(input: State, cmd: Command): State {
  const s = structuredClone(input);
  const upsert = <T extends { id: string }>(list: T[], v: T) => {
    const index = list.findIndex((x) => x.id === v.id);
    if (index < 0) list.push(v);
    else list[index] = v;
  };
  switch (cmd.type) {
    case "account":
      upsert(s.accounts, cmd.value);
      break;
    case "category":
      upsert(s.categories, cmd.value);
      break;
    case "operation": {
      const previous = s.operations.find(
        (o) => o.requestId === cmd.value.requestId,
      );
      if (previous && previous.id !== cmd.value.id) return s;
      const original = s.operations.find((o) => o.id === cmd.value.id);
      if (
        original?.kind === "income" &&
        (cmd.value.kind !== "income" ||
          original.amount !== cmd.value.amount ||
          original.date !== cmd.value.date ||
          original.accountId !== cmd.value.accountId)
      )
        s.allocations = s.allocations.filter((a) => a.incomeId !== original.id);
      const value = { ...cmd.value };
      upsert(s.operations, value);
      break;
    }
    case "plan":
      if (
        s.plans.some(
          (p) =>
            p.id !== cmd.value.id &&
            p.month === cmd.value.month &&
            p.categoryId === cmd.value.categoryId,
        )
      )
        throw Error("Для категории уже есть план этого месяца");
      upsert(s.plans, cmd.value);
      break;
    case "debt": {
      const existing = s.debts.find((d) => d.id === cmd.value.id);
      const d = cmd.value;
      if (
        d.kind === "card" &&
        (!existing ||
          existing.kind !== "card" ||
          existing.accountId !== d.accountId ||
          existing.opening !== d.opening ||
          existing.openingDate !== d.openingDate)
      ) {
        const account = s.accounts.find(
          (a) => a.id === d.accountId && a.kind === "credit",
        );
        if (!account) throw Error("Выбери кредитный счёт");
        if (d.openingDate < account.openingDate)
          throw Error(
            "Дата начальной задолженности не может быть раньше начального остатка кредитного счёта",
          );
        const balance = balanceAt(account, s.operations, d.openingDate);
        if (
          d.openingDate < account.openingDate ||
          BigInt(d.opening) !== (balance < 0n ? -balance : 0n)
        )
          throw Error(
            "Начальная задолженность должна совпадать с остатком кредитного счёта на выбранную дату. Проверь остаток счёта, дату и операции; задолженность учитывается со знаком минус.",
          );
      }
      if (cmd.value.complete && debtBalance(s, cmd.value, today()) > 0n)
        throw Error("Сначала запиши погашение задолженности");
      upsert(s.debts, cmd.value);
      break;
    }
    case "settings":
      if (cmd.value.higherRateConfirmed && hasOutstandingDebt(s, today()))
        throw Error("Сначала погаси все долги");
      s.settings = cmd.value;
      break;
    case "remove": {
      if (cmd.entity === "operations") {
        if (s.operations.some((o) => o.refundOf === cmd.id))
          throw Error("Сначала удали связанные возвраты");
        s.allocations = s.allocations.filter((a) => a.incomeId !== cmd.id);
      }
      if (
        cmd.entity === "accounts" &&
        (s.operations.some(
          (o) => o.accountId === cmd.id || o.toAccountId === cmd.id,
        ) ||
          s.debts.some((d) => d.accountId === cmd.id))
      )
        throw Error("Счёт используется в операциях или долгах");
      if (
        cmd.entity === "categories" &&
        (s.operations.some((o) =>
          o.parts.some((p) => p.categoryId === cmd.id),
        ) ||
          s.plans.some((p) => p.categoryId === cmd.id) ||
          s.rules.some((r) => r.categoryId === cmd.id))
      )
        throw Error("Категория используется в операциях, плане или правилах");
      if (
        cmd.entity === "plans" &&
        s.operations.some((o) => o.planItemId === cmd.id)
      )
        throw Error("План связан с платежами");
      if (
        cmd.entity === "debts" &&
        s.operations.some((o) => o.debtId === cmd.id)
      )
        throw Error("Долг связан с платежами. Отметь его закрытым");
      (s[cmd.entity] as { id: string }[]) = (
        s[cmd.entity] as { id: string }[]
      ).filter((x) => x.id !== cmd.id);
      break;
    }
    case "allocate": {
      if (s.allocations.some((a) => a.incomeId === cmd.incomeId)) return s;
      const p = proposeAllocation(s, cmd.incomeId, today());
      const amount = cmd.amount === undefined ? p.amount : BigInt(cmd.amount);
      const free = buildBudget(s, today()).available;
      if (amount < 0n || amount > (free > 0n ? free : 0n))
        throw Error("Сумма накоплений не может превышать свободные деньги");
      s.allocations.push({
        id: cmd.id,
        incomeId: cmd.incomeId,
        amount: amount.toString(),
        fulfilled: "0",
        createdDate: today(),
        priorTransferIds: s.operations
          .filter((o) => o.kind === "transfer")
          .map((o) => o.id),
      });
      break;
    }
    case "cancelAllocation":
      s.allocations = s.allocations.filter((a) => a.id !== cmd.id);
      break;
    case "copyPlan":
      for (const p of s.plans.filter((p) => p.month === cmd.from)) {
        if (
          s.plans.some(
            (x) => x.month === cmd.to && x.categoryId === p.categoryId,
          )
        )
          continue;
        const end = new Date(
          Number(cmd.to.slice(0, 4)),
          Number(cmd.to.slice(5)),
          0,
        ).getDate();
        s.plans.push({
          ...p,
          id: crypto.randomUUID(),
          month: cmd.to,
          dueDate: p.dueDate
            ? cmd.to +
              "-" +
              Math.min(Number(p.dueDate.slice(-2)), end)
                .toString()
                .padStart(2, "0")
            : undefined,
        });
      }
      break;
    case "rule":
      if (!s.categories.some((c) => c.id === cmd.categoryId))
        throw Error("Категория не найдена");
      upsert(s.rules, {
        id: cmd.id,
        contains: cmd.contains,
        categoryId: cmd.categoryId,
      });
      break;
    case "import":
      if (!s.accounts.some((a) => a.id === cmd.accountId) || cmd.from > cmd.to)
        throw Error("Проверь счёт и период импорта");
      for (const op of cmd.operations) {
        if (
          op.accountId !== cmd.accountId &&
          !(op.kind === "transfer" && op.toAccountId === cmd.accountId)
        )
          throw Error("Счёт импорта не совпадает");
        if (cmd.complete && (op.date < cmd.from || op.date > cmd.to))
          throw Error("Операции выходят за подтверждённый период");
        if (
          !s.operations.some(
            (o) =>
              o.id === op.id ||
              o.requestId === op.requestId ||
              (op.importKey && o.importKey === op.importKey),
          )
        )
          s.operations.push({ ...op });
      }
      if(!s.imports.includes(cmd.batchId))s.imports.push(cmd.batchId);
      s.coverage.push({
        accountId: cmd.accountId,
        from: cmd.from,
        to: cmd.to,
        complete: cmd.complete,
      });
      break;
    case "coverage":
      s.coverage.push({
        accountId: cmd.accountId,
        from: cmd.from,
        to: cmd.to,
        complete: cmd.complete,
      });
      break;
  }
  for (const debt of s.debts)
    if (debt.complete && debtBalance(s, debt, today()) > 0n)
      debt.complete = false;
  if (hasOutstandingDebt(s, today())) s.settings.higherRateConfirmed = false;
  validateState(s);
  return s;
}
