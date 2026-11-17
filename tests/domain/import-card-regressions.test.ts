import { describe, expect, it } from "vitest";
import {
  emptyState,
  stateSchema,
  type Debt,
  type Operation,
} from "../../src/domain/types";
import { applyCommand } from "../../src/domain/commands";
import {
  buildImportOperations,
  previewRows,
  type ImportRow,
} from "../../src/domain/import";
import { refundParts, validateState } from "../../src/domain/ledger";

function setup() {
  const s = emptyState();
  s.accounts = [
    {
      id: "cash",
      name: "Счёт",
      kind: "debit",
      opening: "10000000",
      openingDate: "2026-10-31",
      verifiedDate: "2026-11-17",
    },
    {
      id: "card",
      name: "Карта",
      kind: "credit",
      opening: "-3000000",
      openingDate: "2026-10-31",
      verifiedDate: "2026-11-17",
    },
  ];
  return s;
}
function card(): Debt {
  return {
    id: "debt",
    name: "Карта",
    kind: "card",
    accountId: "card",
    opening: "3000000",
    openingDate: "2026-10-31",
    payment: "0",
    dueDate: "2026-11-30",
    minimum: "500000",
    minimumDate: "2026-11-20",
    graceAmount: "3000000",
    graceDate: "2026-11-30",
    verifiedDate: "2026-11-17",
    coveredOperationIds: [],
    priority: 1,
    rate: "",
    complete: false,
  };
}
const transfer: Operation = {
  id: "transfer",
  requestId: "transfer",
  date: "2026-11-17",
  kind: "transfer",
  accountId: "cash",
  toAccountId: "card",
  amount: "500000",
  description: "Перевод на карту",
  parts: [],
  importKey: "cash:bank-id",
};

describe("Сверка начальной задолженности карты", () => {
  it("отклоняет начальный долг, противоречащий остатку кредитного счёта", () => {
    const s = setup();
    s.accounts[1].opening = "0";
    expect(() => applyCommand(s, { type: "debt", value: card() })).toThrow(
      /задолженность.*остатк/i,
    );
  });
  it("сверяет первоначальный снимок, не новую банковскую льготную сумму", () => {
    let s = setup();
    s = applyCommand(s, { type: "debt", value: card() });
    s = applyCommand(s, { type: "operation", value: transfer });
    expect(() =>
      applyCommand(s, {
        type: "debt",
        value: {
          ...card(),
          verifiedDate: "2026-11-18",
          graceAmount: "2500000",
        },
      }),
    ).not.toThrow();
    expect(() =>
      applyCommand(s, {
        type: "debt",
        value: { ...card(), openingDate: "2026-11-17", opening: "2500000" },
      }),
    ).not.toThrow();
  });
});

describe("Два конца своего перевода", () => {
  it("предлагает существующий перевод при другом банковском ID и описании", () => {
    const s = setup();
    s.operations = [transfer];
    const row = {
      id: "other-bank-id",
      date: transfer.date,
      amount: transfer.amount,
      description: "Пополнение кредитной карты",
      kind: "income" as const,
      incoming: true,
      categoryId: "",
      essential: false,
    };
    expect(previewRows(s, [row], "card")[0].duplicateId).toBe(transfer.id);
    expect(
      previewRows(s, [{ ...row, incoming: false, kind: "expense" }], "card")[0]
        .duplicateId,
    ).toBeUndefined();
    const preview = previewRows(s, [row], "card");
    expect(
      buildImportOperations(s, preview, "card", "batch", { 0: "skip" }),
    ).toHaveLength(0);
    expect(
      buildImportOperations(s, preview, "card", "batch", { 0: "new" }),
    ).toHaveLength(1);
  });
});

describe("Возвраты разделённых покупок при импорте", () => {
  function purchase(): Operation {
    return {
      ...transfer,
      id: "purchase",
      requestId: "purchase",
      kind: "expense",
      accountId: "cash",
      toAccountId: undefined,
      amount: "3",
      parts: [
        { categoryId: "cafe", amount: "1", essential: false, reducible: false },
        { categoryId: "food", amount: "2", essential: true, reducible: false },
      ],
    };
  }
  function row(amount: string): ImportRow {
    return {
      id: "",
      date: "2026-11-17",
      amount,
      description: "Возврат",
      kind: "refund",
      refundOf: "purchase",
      incoming: true,
      categoryId: "",
      essential: false,
    };
  }
  it("учитывает уже сохранённый частичный возврат", () => {
    const s = setup();
    s.operations = [purchase()];
    s.operations.push({
      ...purchase(),
      id: "refund",
      requestId: "refund",
      kind: "refund",
      refundOf: "purchase",
      amount: "1",
      parts: refundParts(s, "purchase", "1"),
    });
    const operations = buildImportOperations(
      s,
      [row("2")],
      "cash",
      "batch",
      {},
    );
    const next = applyCommand(s, {
      type: "import",
      batchId: "batch",
      accountId: "cash",
      operations,
      from: "2026-11-17",
      to: "2026-11-17",
      complete: true,
    });
    expect(() => validateState(next)).not.toThrow();
    expect(operations[0].parts.map((p) => p.amount)).toEqual(["1", "1"]);
  });
  it("учитывает предшествующие возвраты в том же пакете", () => {
    const s = setup();
    s.operations = [purchase()];
    const operations = buildImportOperations(
      s,
      [row("1"), row("2")],
      "cash",
      "batch",
      {},
    );
    expect(() =>
      applyCommand(s, {
        type: "import",
        batchId: "batch",
        accountId: "cash",
        operations,
        from: "2026-11-17",
        to: "2026-11-17",
        complete: true,
      }),
    ).not.toThrow();
    expect(operations[1].parts.map((p) => p.amount)).toEqual(["1", "1"]);
    expect(() =>
      buildImportOperations(s, [row("2"), row("2")], "cash", "batch", {}),
    ).toThrow(/превышает/);
  });
});

describe("Сохранность скопированного плана", () => {
  it("сохраняет валидные идентификаторы при последовательном копировании 18 месяцев", () => {
    let s = setup();
    s.plans = [
      {
        id: "initial-plan",
        month: "2026-11",
        categoryId: "food",
        amount: "100000",
      },
    ];
    let from = "2026-11";
    for (let i = 0; i < 18; i++) {
      const date = new Date(from + "-15T12:00:00Z");
      date.setUTCMonth(date.getUTCMonth() + 1);
      const to = date.toISOString().slice(0, 7);
      s = applyCommand(s, { type: "copyPlan", from, to });
      expect(() => stateSchema.parse(s)).not.toThrow();
      from = to;
    }
    expect(s.plans).toHaveLength(19);
  });
  it("не допускает сохранение структурно невалидного результата", () => {
    const s = setup();
    s.plans = [
      {
        id: "x".repeat(101),
        month: "2026-11",
        categoryId: "food",
        amount: "100000",
      },
    ];
    expect(() => validateState(s)).toThrow();
  });
});
