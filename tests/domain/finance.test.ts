import { describe, it, expect } from "vitest";
import {
  emptyState,
  stateSchema,
  money,
  type State,
  type Operation,
  type Debt,
} from "../../src/domain/types";
import {
  balanceAt,
  validateState,
  expenseParts,
  refundParts,
} from "../../src/domain/ledger";
import { buildBudget, proposeAllocation } from "../../src/domain/budget";
import { debtRequirements, debtBalance } from "../../src/domain/debts";
import { summarizeExpenses } from "../../src/domain/analytics";
import { applyCommand, commandSchema } from "../../src/domain/commands";
import { parseCsv, previewRows, csvExport } from "../../src/domain/import";
const date = "2026-11-17";
function base(): State {
  const s = emptyState();
  s.accounts = [
    {
      id: "a",
      name: "Основной",
      kind: "debit",
      opening: "5000000",
      openingDate: "2026-10-31",
      verifiedDate: date,
    },
    {
      id: "c",
      name: "Кредитка",
      kind: "credit",
      opening: "-3000000",
      openingDate: "2026-10-31",
      verifiedDate: date,
    },
    {
      id: "p",
      name: "Подушка",
      kind: "cushion",
      opening: "0",
      openingDate: "2026-10-31",
      verifiedDate: date,
    },
  ];
  return s;
}
function op(values: Partial<Operation> = {}): Operation {
  return {
    id: "o",
    requestId: "o",
    date,
    kind: "expense",
    amount: "10000",
    accountId: "a",
    description: "Покупка",
    parts: [
      {
        categoryId: "cafe",
        amount: "10000",
        essential: false,
        reducible: false,
      },
    ],
    ...values,
  };
}
function card(): Debt {
  return {
    id: "d",
    name: "Карта",
    kind: "card",
    accountId: "c",
    opening: "3000000",
    openingDate: "2026-10-31",
    payment: "0",
    dueDate: "2026-11-25",
    minimum: "500000",
    minimumDate: "2026-11-20",
    graceAmount: "3000000",
    graceDate: "2026-11-28",
    verifiedDate: "2026-11-01",
    coveredOperationIds: [],
    priority: 1,
    rate: "",
    complete: false,
  };
}
describe("Денежный журнал", () => {
  it("считает копейки без float", () => {
    expect(money("1 234,56")).toBe("123456");
    expect(money("-0,01")).toBe("-1");
    expect(() => money("1.001")).toThrow();
  });
  it("не пересчитывает историю до начального остатка и не удваивает переводы", () => {
    const s = base();
    s.operations = [
      op({ date: "2026-10-31" }),
      op({
        id: "t",
        requestId: "t",
        kind: "transfer",
        amount: "20000",
        toAccountId: "p",
        parts: [],
      }),
    ];
    expect(balanceAt(s.accounts[0], s.operations, date)).toBe(4980000n);
    expect(
      s.accounts
        .filter((a) => a.kind !== "credit")
        .reduce((n, a) => n + balanceAt(a, s.operations, date), 0n),
    ).toBe(5000000n);
    expect(
      s.operations.flatMap(expenseParts).reduce((n, p) => n + p.value, 0n),
    ).toBe(10000n);
  });
  it("проверяет части, частичные возвраты и удаление исходной покупки", () => {
    const s = base();
    s.operations = [
      op(),
      op({
        id: "r",
        requestId: "r",
        kind: "refund",
        refundOf: "o",
        amount: "3000",
        parts: [
          {
            categoryId: "cafe",
            amount: "3000",
            essential: false,
            reducible: false,
          },
        ],
      }),
    ];
    expect(() => validateState(s)).not.toThrow();
    expect(
      s.operations.flatMap(expenseParts).reduce((n, p) => n + p.value, 0n),
    ).toBe(7000n);
    expect(() =>
      applyCommand(s, { type: "remove", entity: "operations", id: "o" }),
    ).toThrow();
    s.operations.push(
      op({
        id: "r2",
        requestId: "r2",
        kind: "refund",
        refundOf: "o",
        amount: "8000",
        parts: [
          {
            categoryId: "cafe",
            amount: "8000",
            essential: false,
            reducible: false,
          },
        ],
      }),
    );
    expect(() => validateState(s)).toThrow();
  });
  it("не удаляет использованный счёт и категорию", () => {
    const s = base();
    s.operations = [op()];
    expect(() =>
      applyCommand(s, { type: "remove", entity: "accounts", id: "a" }),
    ).toThrow();
    expect(() =>
      applyCommand(s, { type: "remove", entity: "categories", id: "cafe" }),
    ).toThrow();
  });
});
describe("Долги", () => {
  it("не складывает минимальный и льготный платежи, резервирует новую покупку один раз", () => {
    const s = base(),
      d = card();
    s.operations = [
      op({
        accountId: "c",
        amount: "100000",
        parts: [
          {
            categoryId: "cafe",
            amount: "100000",
            essential: false,
            reducible: false,
          },
        ],
      }),
    ];
    expect(
      debtRequirements(s, d, date).reduce((n, r) => n + r.amount, 0n),
    ).toBe(3100000n);
    d.graceAmount = "3100000";
    d.verifiedDate = date;
    d.coveredOperationIds = ["o"];
    expect(
      debtRequirements(s, d, date).reduce((n, r) => n + r.amount, 0n),
    ).toBe(3100000n);
  });
  it("погашение карты не расход, тело кредита отдельно от процентов", () => {
    const s = base();
    s.operations = [
      op({ kind: "transfer", toAccountId: "c", parts: [], amount: "1000000" }),
      op({
        id: "pay",
        requestId: "pay",
        kind: "debtPayment",
        debtId: "loan",
        amount: "1000000",
        principal: "800000",
        interest: "200000",
        parts: [],
      }),
    ];
    const d = {
      ...card(),
      id: "loan",
      kind: "loan" as const,
      opening: "10000000",
    };
    s.debts = [d];
    expect(
      s.operations.flatMap(expenseParts).reduce((n, p) => n + p.value, 0n),
    ).toBe(200000n);
    expect(debtBalance(s, d, date)).toBe(9200000n);
    s.operations.pop();
    expect(debtBalance(s, d, date)).toBe(10000000n);
  });
  it("при неизвестной разбивке не выдумывает остаток", () => {
    const s = base(),
      d = { ...card(), id: "loan", kind: "loan" as const, opening: "10000000" };
    s.operations = [
      op({ kind: "debtPayment", debtId: "loan", parts: [], amount: "1000000" }),
    ];
    expect(debtBalance(s, d, date)).toBe(10000000n);
  });
});
describe("План и подушка", () => {
  it("не тратит будущий доход, показывает нехватку и нулевые накопления", () => {
    const s = base();
    s.plans = [
      {
        id: "p1",
        month: "2026-11",
        categoryId: "home",
        amount: "6000000",
        dueDate: "2026-11-25",
      },
    ];
    s.operations = [op({ kind: "income", parts: [], amount: "1000000" })];
    s.settings.cushionBps = 500;
    expect(buildBudget(s, date).cash).toBe(6000000n);
    s.operations = [];
    expect(buildBudget(s, date).deficit).toBe(4000000n);
    s.operations = [op({ kind: "income", parts: [], amount: "1" })];
    expect(proposeAllocation(s, "o", date).amount).toBe(0n);
  });
  it("подтверждение резервирует, перевод увеличивает подушку, повторное подтверждение не удваивает", () => {
    let s = base();
    s.settings.cushionBps = 500;
    s.operations = [op({ kind: "income", parts: [], amount: "1000000" })];
    s = applyCommand(s, { type: "allocate", id: "all", incomeId: "o" });
    expect(buildBudget(s, date).cushionReserved).toBe(50000n);
    expect(buildBudget(s, date).cushion).toBe(0n);
    s = applyCommand(s, { type: "allocate", id: "all2", incomeId: "o" });
    expect(s.allocations).toHaveLength(1);
    s.operations.push(
      op({
        id: "t",
        requestId: "t",
        kind: "transfer",
        parts: [],
        amount: "50000",
        toAccountId: "p",
      }),
    );
    expect(buildBudget(s, date).cushionReserved).toBe(0n);
    expect(buildBudget(s, date).cushion).toBe(50000n);
  });
  it("сохраняет просрочку через месяц и учитывает ближайшие 30 дней", () => {
    const s = base();
    s.plans = [
      {
        id: "p1",
        month: "2026-11",
        categoryId: "home",
        amount: "100000",
        dueDate: "2026-11-25",
      },
    ];
    const b = buildBudget(s, "2026-12-01");
    expect(b.requirements.some((r) => r.id === "p1")).toBe(true);
    expect(b.horizonEnd).toBe("2026-12-31");
  });
});
describe("Аналитика и импорт", () => {
  it("среднее не путает пять суббот и четыре воскресенья", () => {
    const s = base();
    s.operations = [];
    for (let day = 1; day <= 30; day++) {
      const d = `2026-11-${String(day).padStart(2, "0")}`;
      if ([0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()))
        s.operations.push(op({ id: d, requestId: d, date: d }));
    }
    const a = summarizeExpenses(s, "2026-11-01", "2026-11-30");
    expect(a.weekday[5].occurrences).toBe(4);
    expect(a.weekday[6].occurrences).toBe(5);
    expect(a.weekday[5].mean).toBe(a.weekday[6].mean);
  });
  it("возврат прошлого месяца остаётся отрицательным расходом текущего месяца", () => {
    const s = base();
    s.operations = [
      op({ date: "2026-10-10" }),
      op({
        id: "r",
        requestId: "r",
        kind: "refund",
        refundOf: "o",
        amount: "10000",
      }),
    ];
    expect(summarizeExpenses(s, "2026-11-01", "2026-11-30").total).toBe(
      -10000n,
    );
  });
  it("распознаёт тестовый шаблон и отвергает неизвестные поля, ошибочные даты и кодировку", () => {
    expect(
      parseCsv("Дата;Сумма;Описание;ID\n17.11.2026;-450,01;Кафе;1").rows[0]
        .amount,
    ).toBe("45001");
    expect(parseCsv("a,b\n1,2").errors.length).toBeGreaterThan(0);
    expect(
      parseCsv("Дата;Сумма;Описание\n31.02.2026;5;X").rows[0].error,
    ).toBeTruthy();
    expect(parseCsv("\uFFFD").errors.length).toBeGreaterThan(0);
  });
  it("похожие покупки требуют решения, повторный пакет не добавляется", () => {
    let s = base();
    s.operations = [op()];
    const rows = parseCsv("Дата;Сумма;Описание\n17.11.2026;-100;Покупка").rows;
    expect(previewRows(s, rows, "a")[0].duplicateId).toBe("o");
    const command = {
      type: "import" as const,
      batchId: "batch",
      accountId: "a",
      operations: [op({ id: "o2", requestId: "o2" })],
      from: "2026-11-01",
      to: date,
      complete: false,
    };
    s = applyCommand(s, command);
    s = applyCommand(s, command);
    expect(s.operations).toHaveLength(2);
  });
  it("экспорт защищает текст от формул, модель валидируется", () => {
    const s = base();
    s.operations = [op({ description: "=cmd()" })];
    expect(csvExport(s)).toContain("'=cmd()");
    expect(() => stateSchema.parse(s)).not.toThrow();
  });
});
describe("Регрессии связанных резервов", () => {
  it("ручной график резервирует ближайшие платежи и сохраняет неоплаченный прошлый срок", () => {
    let s = base();
    const d = {
      ...card(),
      id: "loan",
      kind: "loan" as const,
      opening: "10000000",
      payment: "100000",
      dueDate: "2026-11-20",
      schedule: [
        { dueDate: "2026-11-20", amount: "100000" },
        { dueDate: "2026-12-10", amount: "200000" },
        { dueDate: "2027-01-10", amount: "300000" },
      ],
    };
    s.debts = [d];
    s.accounts = s.accounts.filter((a) => a.kind !== "credit");
    expect(buildBudget(s, date).obligations).toBe(300000n);
    s = applyCommand(s, {
      type: "operation",
      value: op({
        kind: "debtPayment",
        debtId: "loan",
        debtDueDate: "2026-11-20",
        date: "2026-12-01",
        amount: "100000",
        principal: "90000",
        interest: "10000",
        parts: [],
      }),
    });
    expect(
      buildBudget(s, "2026-12-02")
        .requirements.filter((r) => r.name === d.name)
        .map((r) => r.amount),
    ).toEqual([200000n]);
  });
  it("импорт входящего перевода допускает второй конец и проверяет период подтверждения", () => {
    const s = base();
    const cmd = {
      type: "import" as const,
      batchId: "incoming",
      accountId: "c",
      operations: [op({ kind: "transfer", toAccountId: "c", parts: [] })],
      from: "2026-11-01",
      to: date,
      complete: true,
    };
    expect(applyCommand(s, cmd).operations).toHaveLength(1);
    expect(() => applyCommand(s, { ...cmd, to: "2026-11-10" })).toThrow();
    expect(() =>
      commandSchema.parse({
        type: "coverage",
        accountId: "a",
        from: "2026-11-30",
        to: "2026-11-01",
        complete: true,
      }),
    ).toThrow();
    expect(() =>
      applyCommand(s, {
        type: "coverage",
        accountId: "missing",
        from: "2026-11-01",
        to: date,
        complete: true,
      }),
    ).toThrow();
  });
  it("используемые правила и реальные остатки долгов защищены от обхода настроек", () => {
    const s = base();
    s.rules = [{ id: "rule", contains: "кофе", categoryId: "cafe" }];
    expect(() =>
      applyCommand(s, { type: "remove", entity: "categories", id: "cafe" }),
    ).toThrow();
    expect(() =>
      applyCommand(s, { type: "debt", value: { ...card(), complete: true } }),
    ).toThrow();
    expect(() =>
      applyCommand(s, {
        type: "settings",
        value: { ...s.settings, higherRateConfirmed: true },
      }),
    ).toThrow();
  });
  it("старый перевод и перевод между накопительными счетами не исполняют новое распределение", () => {
    let s = base();
    s.settings.cushionBps = 1000;
    s.operations = [
      op({
        id: "old",
        requestId: "old",
        kind: "transfer",
        date: "2026-11-01",
        toAccountId: "p",
        parts: [],
        amount: "100000",
      }),
      op({ kind: "income", parts: [], amount: "1000000" }),
    ];
    s = applyCommand(s, { type: "allocate", id: "all", incomeId: "o" });
    expect(buildBudget(s, date).cushionReserved).toBe(100000n);
    s.accounts.push({ ...s.accounts[2], id: "p2" });
    s = applyCommand(s, {
      type: "operation",
      value: op({
        id: "move",
        requestId: "move",
        kind: "transfer",
        accountId: "p",
        toAccountId: "p2",
        parts: [],
        amount: "100000",
      }),
    });
    expect(buildBudget(s, date).cushionReserved).toBe(100000n);
  });
  it("один перевод исполняет несколько распределений только в пределах суммы", () => {
    let s = base();
    s.settings.cushionBps = 1000;
    s.operations = [
      op({ kind: "income", parts: [], amount: "1000000" }),
      op({
        id: "i2",
        requestId: "i2",
        kind: "income",
        parts: [],
        amount: "1000000",
      }),
    ];
    s = applyCommand(s, { type: "allocate", id: "a1", incomeId: "o" });
    s = applyCommand(s, { type: "allocate", id: "a2", incomeId: "i2" });
    s = applyCommand(s, {
      type: "operation",
      value: op({
        id: "move",
        requestId: "move",
        kind: "transfer",
        toAccountId: "p",
        parts: [],
        amount: "150000",
      }),
    });
    expect(buildBudget(s, date).cushionReserved).toBe(50000n);
    s = applyCommand(s, { type: "remove", entity: "operations", id: "move" });
    expect(buildBudget(s, date).cushionReserved).toBe(200000n);
  });
  it("фиксированный платёж закрывается связанной поздней операцией, а не любым расходом категории", () => {
    let s = base();
    s.plans = [
      {
        id: "rent",
        month: "2026-11",
        categoryId: "home",
        amount: "100000",
        dueDate: "2026-11-30",
      },
    ];
    const expense = op({
      date: "2026-11-17",
      amount: "100000",
      parts: [
        {
          categoryId: "home",
          amount: "100000",
          essential: true,
          reducible: false,
        },
      ],
    });
    s.operations = [expense];
    expect(
      buildBudget(s, date).requirements.find((r) => r.id === "rent")?.amount,
    ).toBe(100000n);
    s.operations = [{ ...expense, date: "2026-12-01", planItemId: "rent" }];
    expect(
      buildBudget(s, "2026-12-02").requirements.find((r) => r.id === "rent"),
    ).toBeUndefined();
    expect(() =>
      applyCommand(s, { type: "remove", entity: "plans", id: "rent" }),
    ).toThrow();
  });
  it("поздний платёж кредита закрывает именно выбранный срок", () => {
    const s = base(),
      d = {
        ...card(),
        id: "loan",
        kind: "loan" as const,
        opening: "10000000",
        payment: "100000",
        dueDate: "2026-11-30",
      };
    s.debts = [d];
    s.operations = [
      op({
        kind: "debtPayment",
        debtId: d.id,
        debtDueDate: d.dueDate,
        date: "2026-12-01",
        amount: "100000",
        principal: "90000",
        interest: "10000",
        parts: [],
      }),
    ];
    expect(debtRequirements(s, d, "2026-12-02").map((r) => r.dueDate))
      .toEqual(["2026-12-30"]);
    expect(
      debtRequirements(s, { ...d, dueDate: "2026-12-30" }, "2026-12-02")[0]
        .amount,
    ).toBe(100000n);
  });
  it("вся задолженность карты зарезервирована вне горизонта и без записи долга", () => {
    const s = base();
    s.debts = [
      {
        ...card(),
        minimumDate: "2027-01-01",
        graceDate: "2027-01-20",
        graceAmount: "1000000",
      },
    ];
    s.operations = [
      op({
        accountId: "c",
        amount: "100000",
        parts: [
          {
            categoryId: "cafe",
            amount: "100000",
            essential: false,
            reducible: false,
          },
        ],
      }),
    ];
    expect(buildBudget(s, date).obligations).toBe(3100000n);
    s.debts = [];
    expect(buildBudget(s, date).obligations).toBe(3100000n);
  });
  it("сверка и погашение карты не добавляют повторный резерв", () => {
    const s = base(),
      d = card();
    s.debts = [d];
    s.operations = [
      op({
        accountId: "c",
        amount: "100000",
        parts: [
          {
            categoryId: "cafe",
            amount: "100000",
            essential: false,
            reducible: false,
          },
        ],
      }),
    ];
    d.graceAmount = "3100000";
    d.coveredOperationIds = ["o"];
    d.verifiedDate = date;
    expect(buildBudget(s, date).obligations).toBe(3100000n);
    s.operations.push(
      op({
        id: "repay",
        requestId: "repay",
        kind: "transfer",
        toAccountId: "c",
        parts: [],
        amount: "1000000",
      }),
    );
    expect(buildBudget(s, date).obligations).toBe(2100000n);
  });
  it("разделённый возврат сохраняет копейки и исходные категории при нескольких возвратах", () => {
    const s = base();
    s.operations = [
      op({
        amount: "3",
        parts: [
          {
            categoryId: "cafe",
            amount: "1",
            essential: false,
            reducible: false,
          },
          {
            categoryId: "food",
            amount: "2",
            essential: true,
            reducible: false,
          },
        ],
      }),
    ];
    const first = op({
      id: "r",
      requestId: "r",
      kind: "refund",
      refundOf: "o",
      amount: "1",
      parts: refundParts(s, "o", "1"),
    });
    s.operations.push(first);
    const rest = op({
      id: "r2",
      requestId: "r2",
      kind: "refund",
      refundOf: "o",
      amount: "2",
      parts: refundParts(s, "o", "2"),
    });
    s.operations.push(rest);
    expect(() => validateState(s)).not.toThrow();
    expect(
      s.operations
        .filter((o) => o.kind === "refund")
        .flatMap((o) => o.parts)
        .reduce((n, p) => n + BigInt(p.amount), 0n),
    ).toBe(3n);
    rest.parts = [
      {
        categoryId: "shopping",
        amount: "2",
        essential: false,
        reducible: false,
      },
    ];
    expect(() => validateState(s)).toThrow();
  });
});
