import { z } from "zod";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s,
    "Проверь дату",
  );
export const moneySchema = z.string().regex(/^-?\d{1,15}$/);
export const positiveMoney = moneySchema.refine(
  (s) => BigInt(s) > 0n,
  "Сумма должна быть больше нуля",
);
const id = z.string().min(1).max(100),
  label = z.string().trim().min(1).max(120);
export const accountSchema = z.object({
  id,
  name: label,
  kind: z.enum(["debit", "credit", "cushion", "cash"]),
  opening: moneySchema,
  openingDate: dateSchema,
  verifiedDate: dateSchema,
});
export const categorySchema = z.object({
  id,
  name: label,
  essential: z.boolean(),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
});
export const partSchema = z.object({
  categoryId: z.string(),
  amount: positiveMoney,
  essential: z.boolean(),
  reducible: z.boolean().default(false),
});
export const operationSchema = z.object({
  id,
  kind: z.enum(["income", "expense", "transfer", "refund", "debtPayment"]),
  date: dateSchema,
  amount: positiveMoney,
  accountId: id,
  toAccountId: z.string().optional(),
  description: z.string().max(300),
  parts: z.array(partSchema).default([]),
  planItemId: id.optional(),
  debtId: z.string().optional(),
  debtDueDate: dateSchema.optional(),
  principal: moneySchema.optional(),
  interest: moneySchema.optional(),
  refundOf: z.string().optional(),
  importKey: z.string().optional(),
  requestId: id,
});
export const planItemSchema = z.object({
  id,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  categoryId: id,
  amount: positiveMoney,
  dueDate: dateSchema.optional(),
});
export const debtSchema = z.object({
  id,
  name: label,
  kind: z.enum(["card", "loan", "personal"]),
  opening: positiveMoney,
  openingDate: dateSchema,
  accountId: z.string().optional(),
  payment: moneySchema,
  dueDate: dateSchema,
  schedule: z
    .array(z.object({ dueDate: dateSchema, amount: positiveMoney }))
    .max(600)
    .optional(),
  minimum: moneySchema,
  minimumDate: dateSchema,
  graceAmount: moneySchema,
  graceDate: dateSchema,
  verifiedDate: dateSchema,
  coveredOperationIds: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(100),
  rate: z.string().max(20).default(""),
  complete: z.boolean().default(false),
});
export const allocationSchema = z.object({
  id,
  incomeId: id,
  amount: moneySchema,
  fulfilled: moneySchema.default("0"),
  createdDate: dateSchema,
  priorTransferIds: z.array(id).optional(),
});
export const coverageSchema = z.object({
  accountId: id,
  from: dateSchema,
  to: dateSchema,
  complete: z.boolean(),
});
export const settingsSchema = z.object({
  expectedIncome: positiveMoney,
  cushionBps: z.number().int().min(0).max(10000),
  afterDebtBps: z.number().int().min(0).max(10000),
  cushionTarget: positiveMoney,
  higherRateConfirmed: z.boolean().default(false),
});
export const stateSchema = z.object({
  accounts: z.array(accountSchema),
  categories: z.array(categorySchema),
  operations: z.array(operationSchema),
  plans: z.array(planItemSchema),
  debts: z.array(debtSchema),
  allocations: z.array(allocationSchema),
  coverage: z.array(coverageSchema),
  imports: z.array(z.string()),
  rules: z.array(z.object({ id, contains: label, categoryId: id })),
  settings: settingsSchema,
});
export type State = z.infer<typeof stateSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type Debt = z.infer<typeof debtSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
export type Part = z.infer<typeof partSchema>;
export type LocalDate = string;
export type Money = bigint;
export type Id = string;
export function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(
    new Date(),
  );
}
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthEnd(date: string) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}
export function money(value: string) {
  const s = value.replace(/[\s₽]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s))
    throw new Error("Введи сумму с точностью до копейки");
  const neg = s.startsWith("-"),
    [rub, kop = ""] = s.replace("-", "").split(".");
  return (
    (BigInt(rub) * 100n + BigInt(kop.padEnd(2, "0"))) *
    (neg ? -1n : 1n)
  ).toString();
}
export function rub(value: string | bigint, decimals = false) {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${(a / 100n).toLocaleString("ru-RU")}${decimals ? "," + (a % 100n).toString().padStart(2, "0") : ""} ₽`;
}
export function emptyState(): State {
  return {
    accounts: [],
    categories: [
      { id: "food", name: "Продукты", essential: true, color: "#385de0" },
      { id: "home", name: "Жильё и связь", essential: true, color: "#7589bd" },
      { id: "transport", name: "Транспорт", essential: true, color: "#629fbc" },
      {
        id: "cafe",
        name: "Кафе и доставка",
        essential: false,
        color: "#be8460",
      },
      { id: "shopping", name: "Покупки", essential: false, color: "#8d75b6" },
      { id: "leisure", name: "Отдых", essential: false, color: "#659e8b" },
      {
        id: "interest",
        name: "Проценты и комиссии",
        essential: true,
        color: "#c25b45",
      },
    ],
    operations: [],
    plans: [],
    debts: [],
    allocations: [],
    coverage: [],
    imports: [],
    rules: [],
    settings: {
      expectedIncome: "20000000",
      cushionBps: 0,
      afterDebtBps: 0,
      cushionTarget: "60000000",
      higherRateConfirmed: false,
    },
  };
}
