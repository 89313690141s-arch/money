import { describe, expect, it } from "vitest";
import {
  addDays,
  emptyState,
  today,
  type Debt,
  type Operation,
} from "../../src/domain/types";
import { applyCommand, commandSchema } from "../../src/domain/commands";
import { buildBudget, proposeAllocation } from "../../src/domain/budget";
import { debtBalance, debtRequirements } from "../../src/domain/debts";

const date = today();
function base() {
  const s = emptyState();
  s.accounts = [
    {
      id: "cash",
      name: "Счёт",
      kind: "debit",
      opening: "10000000",
      openingDate: addDays(date, -60),
      verifiedDate: date,
    },
    {
      id: "saving",
      name: "Подушка",
      kind: "cushion",
      opening: "0",
      openingDate: addDays(date, -60),
      verifiedDate: date,
    },
  ];
  s.settings.cushionBps = 500;
  s.settings.afterDebtBps = 2500;
  return s;
}
function income(): Operation {
  return {
    id: "income",
    requestId: "income",
    kind: "income",
    date,
    amount: "1000000",
    accountId: "cash",
    description: "Доход",
    parts: [],
  };
}
function loan(): Debt {
  return {
    id: "loan",
    name: "Кредит",
    kind: "loan",
    opening: "100000",
    openingDate: addDays(date, -60),
    payment: "100000",
    dueDate: date,
    schedule: [{ dueDate: date, amount: "100000" }],
    minimum: "0",
    minimumDate: date,
    graceAmount: "0",
    graceDate: date,
    verifiedDate: addDays(date, -1),
    coveredOperationIds: [],
    priority: 1,
    rate: "",
    complete: false,
  };
}
function paidLoan() {
  let s = base();
  s.debts = [loan()];
  s.operations = [
    {
      ...income(),
      id: "payment",
      requestId: "payment",
      kind: "debtPayment",
      amount: "100000",
      debtId: "loan",
      debtDueDate: date,
      principal: "100000",
      interest: "0",
    },
  ];
  s = applyCommand(s, {
    type: "debt",
    value: { ...s.debts[0], complete: true },
  });
  return s;
}

describe("Корректировки сохранённых финансовых данных", () => {
  it("удаление последнего платежа открывает долг и возвращает резерв", () => {
    const s = applyCommand(paidLoan(), {
      type: "remove",
      entity: "operations",
      id: "payment",
    });
    expect(s.debts[0].complete).toBe(false);
    expect(debtBalance(s, s.debts[0], date)).toBe(100000n);
    expect(buildBudget(s, date).obligations).toBe(100000n);
  });
  it("уменьшение последнего платежа открывает долг и резервирует неоплаченное", () => {
    const original = paidLoan();
    const s = applyCommand(original, {
      type: "operation",
      value: { ...original.operations[0], amount: "40000", principal: "40000" },
    });
    expect(s.debts[0].complete).toBe(false);
    expect(buildBudget(s, date).obligations).toBe(60000n);
    const legacy = { ...s.debts[0], complete: true };
    expect(debtRequirements(s, legacy, date)[0].amount).toBe(60000n);
  });
  it.each(["amount", "date", "accountId", "kind"] as const)(
    "изменение %s дохода требует повторного распределения",
    (field) => {
      let s = base();
      s.operations = [income()];
      s = applyCommand(s, {
        type: "allocate",
        id: "allocation",
        incomeId: "income",
      });
      const changes = {
        amount: "100000",
        date: addDays(date, -1),
        accountId: "saving",
        kind: "transfer",
      };
      const edited = { ...income(), [field]: changes[field] } as Operation;
      if (field === "kind") edited.toAccountId = "saving";
      s = applyCommand(s, { type: "operation", value: edited });
      expect(s.allocations).toEqual([]);
      expect(buildBudget(s, date).cushionReserved).toBe(0n);
    },
  );
  it("изменение описания не отменяет подтверждённое распределение", () => {
    let s = base();
    s.operations = [income()];
    s = applyCommand(s, {
      type: "allocate",
      id: "allocation",
      incomeId: "income",
    });
    s = applyCommand(s, {
      type: "operation",
      value: { ...income(), description: "Исправлено" },
    });
    expect(s.allocations).toHaveLength(1);
  });
  it("позволяет задать сумму резерва и отменить его без отмены перевода", () => {
    let s = base();
    s.operations = [income()];
    const command = commandSchema.parse({
      type: "allocate",
      id: "allocation",
      incomeId: "income",
      amount: "70000",
    });
    if (command.type !== "allocate") throw Error("Expected allocation command");
    s = applyCommand(s, command);
    expect(buildBudget(s, date).cushionReserved).toBe(70000n);
    const transfer = {
      ...income(),
      id: "transfer",
      requestId: "transfer",
      kind: "transfer" as const,
      toAccountId: "saving",
      amount: "20000",
    };
    s = applyCommand(s, { type: "operation", value: transfer });
    s = applyCommand(s, { type: "cancelAllocation", id: "allocation" });
    expect(buildBudget(s, date).cushionReserved).toBe(0n);
    expect(buildBudget(s, date).cushion).toBe(20000n);
    expect(s.operations).toContainEqual(transfer);
    expect(() => applyCommand(s, { ...command, amount: "-1" })).toThrow();
    expect(() =>
      applyCommand(s, { ...command, amount: "999999999" }),
    ).toThrow();
  });
  it("новый долг отменяет повышенный процент, также защищает старое состояние", () => {
    let s = base();
    s.operations = [income()];
    s.settings.higherRateConfirmed = true;
    s = applyCommand(s, { type: "debt", value: loan() });
    expect(s.settings.higherRateConfirmed).toBe(false);
    expect(proposeAllocation(s, "income", date).amount).toBe(50000n);
    s.settings.higherRateConfirmed = true;
    expect(proposeAllocation(s, "income", date).amount).toBe(50000n);
  });
  it("новая покупка кредиткой отменяет повышенный процент даже без карточного долга", () => {
    let s = base();
    s.accounts.push({
      ...s.accounts[0],
      id: "card",
      kind: "credit",
      opening: "0",
    });
    s.settings.higherRateConfirmed = true;
    s = applyCommand(s, {
      type: "operation",
      value: {
        ...income(),
        kind: "expense",
        accountId: "card",
        parts: [
          {
            categoryId: "cafe",
            amount: "1000000",
            essential: false,
            reducible: false,
          },
        ],
      },
    });
    expect(s.settings.higherRateConfirmed).toBe(false);
  });
});

describe("Банковские сроки карты и полнота истории", () => {
  function cardState() {
    const s = base();
    s.accounts.push({
      ...s.accounts[0],
      id: "card",
      kind: "credit",
      opening: "-1000000",
    });
    s.debts = [
      {
        ...loan(),
        kind: "card",
        accountId: "card",
        opening: "1000000",
        minimum: "10000",
        minimumDate: addDays(date, 5),
        graceAmount: "300000",
        graceDate: addDays(date, 10),
      },
    ];
    return s;
  }
  it("показывает банковскую льготную сумму отдельно от прочего зарезервированного долга", () => {
    const s = cardState(),
      r = debtRequirements(s, s.debts[0], date);
    expect(r.find((x) => x.id.endsWith(":min"))?.amount).toBe(10000n);
    expect(r.find((x) => x.id.endsWith(":grace"))?.amount).toBe(290000n);
    expect(r.find((x) => x.reserveOnly)?.amount).toBe(700000n);
    expect(buildBudget(s, date).obligations).toBe(1000000n);
  });
  it("ранний льготный срок не переносит свою часть на поздний минимум", () => {
    const s = cardState();
    s.debts[0].graceDate = addDays(date, 2);
    const r = debtRequirements(s, s.debts[0], date);
    expect(r.find((x) => x.id.endsWith(":grace"))?.amount).toBe(300000n);
    expect(r.some((x) => x.id.endsWith(":min"))).toBe(false);
    expect(r.reduce((n, x) => n + x.amount, 0n)).toBe(1000000n);
  });
  it("погашение уменьшает текущую банковскую сумму, будущий резерв сохраняется", () => {
    const s = cardState();
    s.operations = [
      { ...income(), kind: "transfer", toAccountId: "card", amount: "200000" },
    ];
    const r = debtRequirements(s, s.debts[0], date);
    expect(r.find((x) => x.id.endsWith(":grace"))?.amount).toBe(100000n);
    expect(r.find((x) => x.reserveOnly)?.amount).toBe(700000n);
    expect(buildBudget(s, date).obligations).toBe(800000n);
  });
  it("полнота одного счёта не подтверждает второй расходный счёт", () => {
    const s = base();
    s.accounts.push({ ...s.accounts[0], id: "second" });
    s.coverage = [
      {
        accountId: "cash",
        from: date.slice(0, 7) + "-01",
        to: date,
        complete: true,
      },
    ];
    expect(buildBudget(s, date).preliminary).toBe(true);
    s.coverage.push({ ...s.coverage[0], accountId: "second" });
    expect(buildBudget(s, date).preliminary).toBe(false);
  });
});
