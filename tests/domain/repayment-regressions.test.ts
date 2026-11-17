import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/domain/commands";
import { debtBalance, debtRequirements, debtSchedule } from "../../src/domain/debts";
import { buildBudget } from "../../src/domain/budget";
import { emptyState, type Debt, type Operation } from "../../src/domain/types";

function setup() {
  const s = emptyState();
  s.accounts = [{ id: "cash", name: "Счёт", kind: "debit", opening: "10000000",
    openingDate: "2026-09-30", verifiedDate: "2026-11-17" }];
  const debt: Debt = { id: "loan", name: "Долг", kind: "loan", opening: "1000000",
    openingDate: "2026-09-30", payment: "100000", dueDate: "2026-10-15",
    schedule: [{ dueDate: "2026-10-15", amount: "100000" },
      { dueDate: "2026-11-15", amount: "200000" }],
    minimum: "0", minimumDate: "2026-11-17", graceAmount: "0", graceDate: "2026-11-17",
    verifiedDate: "2026-11-17", coveredOperationIds: [], priority: 1, rate: "", complete: false };
  s.debts = [debt];
  return s;
}
function payment(id: string, date: string, amount: string, dueDate?: string): Operation {
  return { id, requestId: "bank:" + id, importKey: "cash:" + id, kind: "debtPayment",
    date, amount, accountId: "cash", debtId: "loan", debtDueDate: dueDate,
    description: "Погашение", parts: [] };
}
function importPayments(operations: Operation[]) {
  return applyCommand(setup(), { type: "import", batchId: "batch", accountId: "cash",
    operations, from: "2026-10-01", to: "2026-11-17", complete: true });
}

describe("Связь банковских платежей с графиком", () => {
  it('досрочное тело не погашает будущий график банка автоматически',()=>{
    const s=setup();s.debts[0].opening='10000000';s.debts[0].schedule=[{dueDate:'2026-11-20',amount:'1000000'},{dueDate:'2026-12-20',amount:'1000000'}];
    s.operations=[{...payment('regular','2026-11-17','1000000','2026-11-20'),principal:'800000',interest:'200000'},{...payment('early','2026-11-17','1000000'),principal:'1000000',interest:'0'}];
    expect(debtBalance(s,s.debts[0],'2026-11-17')).toBe(8200000n);expect(debtRequirements(s,s.debts[0],'2026-11-17').map(r=>[r.dueDate,r.amount])).toEqual([['2026-12-20',1000000n]]);
  });
  it('повтор частичного импорта добавляет ранее пропущенные строки без дублей',()=>{
    const rows=[payment('oct','2026-10-15','100000'),payment('nov','2026-11-15','200000')];let s=applyCommand(setup(),{type:'import',batchId:'partial',accountId:'cash',operations:rows.slice(0,1),from:'2026-10-01',to:'2026-11-17',complete:false});
    s=applyCommand(s,{type:'import',batchId:'partial',accountId:'cash',operations:rows,from:'2026-10-01',to:'2026-11-17',complete:true});expect(s.operations).toHaveLength(2);expect(s.imports.filter(k=>k==='partial')).toHaveLength(1);expect(s.coverage.at(-1)?.complete).toBe(true);
  });
  it("сопоставляет обратный порядок выписки без изменения банковской идентичности", () => {
    const rows = [payment("nov", "2026-11-15", "200000"), payment("oct", "2026-10-15", "100000")];
    const s = importPayments(rows);
    expect(s.operations).toEqual(rows);
    expect(debtRequirements(s, s.debts[0], "2026-11-17")).toEqual([]);
    expect(buildBudget(s, "2026-11-17").obligations).toBe(0n);
  });
  it("частичные и поздние суммы сначала закрывают старую задолженность", () => {
    const s = importPayments([payment("late", "2026-11-16", "90000"),
      payment("partial", "2026-10-20", "40000")]);
    expect(debtRequirements(s, s.debts[0], "2026-11-17").map((r) => [r.dueDate, r.amount]))
      .toEqual([["2026-11-15", 170000n]]);
  });
  it("одна операция может закрыть несколько сроков", () => {
    const s = importPayments([payment("catchup", "2026-11-16", "300000")]);
    expect(debtRequirements(s, s.debts[0], "2026-11-17")).toEqual([]);
  });
  it("явно выбранный срок не закрывает другую просрочку", () => {
    const s = importPayments([payment("chosen", "2026-11-16", "200000", "2026-11-15")]);
    expect(s.operations[0].debtDueDate).toBe("2026-11-15");
    expect(debtRequirements(s, s.debts[0], "2026-11-17").map((r) => r.dueDate))
      .toEqual(["2026-10-15"]);
  });
  it("изменение и удаление платежа пересчитывает исполненные сроки", () => {
    let s = importPayments([payment("catchup", "2026-11-16", "300000")]);
    s = applyCommand(s, { type: "operation", value: { ...s.operations[0], amount: "150000" } });
    expect(debtRequirements(s, s.debts[0], "2026-11-17").map((r) => r.amount)).toEqual([150000n]);
    s = applyCommand(s, { type: "remove", entity: "operations", id: "catchup" });
    expect(debtRequirements(s, s.debts[0], "2026-11-17").map((r) => r.amount))
      .toEqual([100000n, 200000n]);
  });
});

describe("Ежемесячное погашение без полного банковского графика", () => {
  it("после первого платежа резервирует ноябрь и ближайший декабрь", () => {
    const s = setup();
    s.debts[0] = { ...s.debts[0], kind: "personal", schedule: undefined };
    s.operations = [payment("oct", "2026-10-15", "100000", "2026-10-15")];
    expect(debtBalance(s, s.debts[0], "2026-11-17")).toBe(900000n);
    expect(debtRequirements(s, s.debts[0], "2026-11-17").map((r) => [r.dueDate, r.amount]))
      .toEqual([["2026-11-15", 100000n], ["2026-12-15", 100000n]]);
    expect(buildBudget(s, "2026-11-17").obligations).toBe(200000n);
  });
  it("сохраняет просроченные месяцы и ограничивает беспроцентные платежи остатком долга", () => {
    const s = setup();
    s.debts[0] = { ...s.debts[0], kind: "personal", schedule: undefined, opening: "150000" };
    expect(debtRequirements(s, s.debts[0], "2026-11-17").map((r) => [r.dueDate, r.amount]))
      .toEqual([["2026-10-15", 100000n], ["2026-11-15", 50000n]]);
  });
  it("сжимает 31 число до конца короткого месяца, затем возвращается к 31", () => {
    const d = { ...setup().debts[0], dueDate: "2028-01-31", schedule: undefined };
    expect(debtSchedule(d, "2028-03-01").map((p) => p.dueDate))
      .toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
    expect(debtSchedule({ ...d, dueDate: "2027-01-31" }, "2027-03-01").map((p) => p.dueDate))
      .toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
  it("не придумывает продолжение полного банковского графика", () => {
    const s = setup();
    expect(debtSchedule(s.debts[0], "2027-03-01")).toHaveLength(2);
  });
});

describe("Повтор сохранения с постоянной идентичностью формы", () => {
  it("повтор после потерянного ответа сохраняет один платёж и один расход денег", () => {
    const command = { type: "operation" as const, value: payment("dialog", "2026-11-16", "100000") };
    const first = applyCommand(setup(), command);
    const retried = applyCommand(first, command);
    expect(retried.operations).toEqual(first.operations);
    expect(buildBudget(retried, "2026-11-17").cash).toBe(buildBudget(first, "2026-11-17").cash);
  });
});
