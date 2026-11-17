import Papa from "papaparse";
import { dateSchema, money, type State, type Operation } from "./types";
import { refundParts } from "./ledger";
export type ImportRow = {
  id: string;
  date: string;
  amount: string;
  description: string;
  kind: "income" | "expense" | "transfer" | "refund" | "debtPayment";
  categoryId: string;
  essential: boolean;
  incoming?: boolean;
  counterAccountId?: string;
  refundOf?: string;
  debtId?: string;
  duplicateId?: string;
  transferCandidate?: boolean;
  error?: string;
};
export const template =
  "Дата;Сумма;Описание;ID\n17.11.2026;-450,00;Кафе;example-1\n17.11.2026;50000,00;Доход;example-2\n";
export function parseCsv(text: string): {
  rows: ImportRow[];
  errors: string[];
} {
  if (text.includes("\uFFFD"))
    return {
      rows: [],
      errors: ["Не удалось прочитать кодировку. Сохрани файл в UTF-8."],
    };
  const parsed = Papa.parse<Record<string, string>>(
    text.replace(/^\uFEFF/, ""),
    { header: true, skipEmptyLines: "greedy", delimiter: ";" },
  );
  if (
    !["Дата", "Сумма", "Описание"].every((h) => parsed.meta.fields?.includes(h))
  )
    return {
      rows: [],
      errors: [
        "Нужны колонки «Дата», «Сумма», «Описание» с разделителем ;. Это тестовый шаблон, формат выписки Т-Банка пока не проверен.",
      ],
    };
  const errors = parsed.errors.map(
    (e) => `Строка ${(e.row ?? 0) + 2}: ${e.message}`,
  );
  const rows = parsed.data.map((row, i): ImportRow => {
    try {
      const d = row["Дата"].trim(),
        date = /^\d{2}\.\d{2}\.\d{4}$/.test(d)
          ? d.split(".").reverse().join("-")
          : d;
      dateSchema.parse(date);
      const signed = BigInt(money(row["Сумма"]));
      if (!signed) throw Error("Нулевая сумма");
      return {
        id: row["ID"]?.trim() ?? "",
        date,
        amount: (signed < 0n ? -signed : signed).toString(),
        description: row["Описание"]?.slice(0, 300) ?? "",
        kind: signed > 0n ? "income" : "expense",
        incoming: signed > 0n,
        categoryId: "",
        essential: false,
      };
    } catch {
      return {
        id: "",
        date: "",
        amount: "0",
        description: row["Описание"] ?? "",
        kind: "expense",
        categoryId: "",
        essential: false,
        error: `Строка ${i + 2}: проверь дату и сумму`,
      };
    }
  });
  if (rows.length > 10000)
    errors.push("За один раз можно загрузить не больше 10 000 операций");
  return { rows, errors };
}
export function previewRows(s: State, rows: ImportRow[], accountId: string) {
  return rows.map((row) => {
    const rule = s.rules.find((r) =>
        row.description
          .toLocaleLowerCase("ru")
          .includes(r.contains.toLocaleLowerCase("ru")),
      ),
      cat = s.categories.find((c) => c.id === rule?.categoryId);
    const duplicate = s.operations.find(
      (o) =>
        (o.accountId === accountId || o.toAccountId === accountId) &&
        ((row.id && o.importKey === accountId + ":" + row.id) ||
          (o.date === row.date &&
            o.amount === row.amount &&
            o.description === row.description)),
    );
    const transfer = s.operations.find(
      (o) =>
        o.kind === "transfer" &&
        o.date === row.date &&
        o.amount === row.amount &&
        (row.incoming
          ? o.toAccountId === accountId
          : o.accountId === accountId),
    );
    const candidate = duplicate ?? transfer;
    return {
      ...row,
      categoryId: cat?.id ?? row.categoryId,
      essential: cat?.essential ?? row.essential,
      duplicateId: candidate?.id,
      transferCandidate: candidate?.kind === "transfer",
    };
  });
}
export function buildImportOperations(
  s: State,
  rows: ImportRow[],
  accountId: string,
  batchKey: string,
  choices: Record<number, string>,
): Operation[] {
  const working = { ...s, operations: [...s.operations] };
  const operations: Operation[] = [];
  for (const [i, r] of rows.entries()) {
    if (
      r.error ||
      choices[i] === "skip" ||
      (r.duplicateId && choices[i] !== "new")
    )
      continue;
    const operation: Operation = {
      id: crypto.randomUUID(),
      requestId: batchKey + ":" + i,
      kind: r.kind,
      date: r.date,
      accountId:
        r.kind === "transfer" && r.incoming
          ? (r.counterAccountId ?? "")
          : accountId,
      toAccountId:
        r.kind === "transfer"
          ? r.incoming
            ? accountId
            : r.counterAccountId
          : undefined,
      refundOf: r.kind === "refund" ? r.refundOf : undefined,
      debtId: r.kind === "debtPayment" ? r.debtId : undefined,
      amount: r.amount,
      description: r.description,
      parts:
        r.kind === "refund"
          ? refundParts(working, r.refundOf ?? "", r.amount)
          : r.kind === "expense"
            ? [
                {
                  categoryId: r.categoryId,
                  essential: r.essential,
                  reducible: false,
                  amount: r.amount,
                },
              ]
            : [],
      importKey: r.id && !r.duplicateId ? accountId + ":" + r.id : undefined,
    };
    working.operations.push(operation);
    operations.push(operation);
  }
  return operations;
}
export function csvExport(s: State) {
  const safe = (v: string) => {
    const t = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
    return '"' + t.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFFДата;Тип;Сумма в копейках;Описание\r\n" +
    s.operations
      .map((o) => [o.date, o.kind, o.amount, o.description].map(safe).join(";"))
      .join("\r\n")
  );
}
