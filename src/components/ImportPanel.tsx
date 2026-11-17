"use client";
import { useState } from "react";
import { Upload, Download, AlertCircle } from "lucide-react";
import {
  parseCsv,
  previewRows,
  template,
  buildImportOperations,
  type ImportRow,
} from "@/domain/import";
import { today, rub, type State } from "@/domain/types";
import type { Save } from "./Forms";
export function ImportPanel({
  s,
  save,
  close,
}: {
  s: State;
  save: Save;
  close: () => void;
}) {
  const [account, setAccount] = useState(s.accounts[0]?.id ?? ""),
    [rows, setRows] = useState<ImportRow[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [choices, setChoices] = useState<Record<number, string>>({}),
    [hash, setHash] = useState(""),
    [busy, setBusy] = useState(false),
    [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today()),
    [complete, setComplete] = useState(false),
    [allowPartial, setAllowPartial] = useState(false);
  function updateRow(index: number, patch: Partial<ImportRow>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + template], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "example-finance.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function read(file: File) {
    setErrors([]);
    setRows([]);
    setChoices({});
    if (file.size > 10 * 1024 * 1024) {
      setErrors(["Максимальный размер файла — 10 МБ"]);
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      setHash(
        Array.from(new Uint8Array(digest))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join(""),
      );
      const parsed = parseCsv(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      setRows(
        previewRows(s, parsed.rows, account).map((r) =>
          s.accounts.find((a) => a.id === account)?.kind === "credit" &&
          r.incoming
            ? { ...r, kind: "transfer" }
            : r,
        ),
      );
      setErrors(parsed.errors);
    } catch {
      setErrors(["Не удалось прочитать файл. Сохрани CSV в UTF-8 и повтори."]);
    }
  }
  async function confirmImport() {
    setBusy(true);
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(account + ":" + hash),
      );
      const batchKey = Array.from(new Uint8Array(digest))
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      const operations = buildImportOperations(
        s,
        rows,
        account,
        batchKey,
        choices,
      );
      const success = await save({
        type: "import",
        batchId: batchKey,
        accountId: account,
        operations,
        from,
        to,
        complete:
          complete &&
          !errors.length &&
          !rows.some((r) => r.error) &&
          !rows.some((r, i) => !r.duplicateId && choices[i] === "skip") &&
          !allowPartial,
      });
      if (success) close();
      else
        setErrors([
          "Не удалось сохранить. Проверь типы операций, связи и суммы, затем повтори.",
        ]);
    } catch (e) {
      setErrors([
        e instanceof Error ? e.message : "Не удалось подготовить импорт",
      ]);
    } finally {
      setBusy(false);
    }
  }
  const unresolved = rows.some(
    (r, i) =>
      (r.duplicateId && !choices[i]) ||
      (!r.error &&
        choices[i] !== "skip" &&
        (!r.duplicateId || choices[i] === "new") &&
        ((r.kind === "transfer" && !r.counterAccountId) ||
          (r.kind === "refund" && !r.refundOf) ||
          (r.kind === "debtPayment" && !r.debtId))),
  );
  return (
    <div className="import-panel">
      <div className="alert neutral">
        <AlertCircle size={18} />
        <span>
          Тестовый CSV-шаблон. Реальная выписка Т-Банка ещё не проверена.
          Проверь типы, категории и связи переводов до добавления.
        </span>
      </div>
      <label>
        Счёт импорта
        <select
          value={account}
          disabled={rows.length > 0}
          onChange={(e) => setAccount(e.target.value)}
        >
          {s.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="upload-zone">
        <Upload size={27} />
        <strong>Выбери CSV-файл</strong>
        <span>UTF-8 · разделитель ; · до 10 МБ</span>
        <input
          aria-label="Выбрать CSV-файл"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
      </div>
      <button className="text-btn" onClick={download}>
        <Download size={16} />
        Скачать тестовый шаблон
      </button>
      {errors.map((e, i) => (
        <p className="error" key={i}>
          {e}
        </p>
      ))}
      {rows.length > 0 && (
        <>
          <div className="section-head">
            <h3>Предпросмотр · {rows.length} записей</h3>
            <span className="small muted">Ничего не добавлено</span>
          </div>
          <div className="import-rows">
            {rows.map((r, i) => (
              <div className="import-row" key={i}>
                {r.error ? (
                  <p className="error">{r.error}</p>
                ) : (
                  <>
                    <span>
                      <strong>{r.description || "Без описания"}</strong>
                      <small>
                        {r.date} · {r.kind === "income" ? "Доход" : "Расход"}
                      </small>
                    </span>
                    <b>
                      {r.kind === "income" ? "+" : "−"}
                      {rub(r.amount)}
                    </b>
                    <select
                      aria-label={"Тип импорта " + (i + 1)}
                      value={r.kind}
                      onChange={(e) =>
                        updateRow(i, {
                          kind: e.target.value as ImportRow["kind"],
                        })
                      }
                    >
                      <option value="expense">Расход</option>
                      <option
                        value="income"
                        disabled={
                          s.accounts.find((a) => a.id === account)?.kind ===
                          "credit"
                        }
                      >
                        Доход
                      </option>
                      <option value="transfer">Перевод между счетами</option>
                      <option value="refund">Возврат покупки</option>
                      <option value="debtPayment">Платёж по долгу</option>
                    </select>
                    {r.kind === "transfer" && (
                      <label>
                        Другой свой счёт
                        <select
                          aria-label={"Другой счёт импорта " + (i + 1)}
                          value={r.counterAccountId ?? ""}
                          onChange={(e) =>
                            updateRow(i, { counterAccountId: e.target.value })
                          }
                        >
                          <option value="">Выбери счёт</option>
                          {s.accounts
                            .filter((a) => a.id !== account)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {r.kind === "refund" && (
                      <select
                        aria-label={"Покупка возврата " + (i + 1)}
                        value={r.refundOf ?? ""}
                        onChange={(e) =>
                          updateRow(i, { refundOf: e.target.value })
                        }
                      >
                        <option value="">Исходная покупка</option>
                        {s.operations
                          .filter((o) => o.kind === "expense")
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.date} · {o.description} · {rub(o.amount)}
                            </option>
                          ))}
                      </select>
                    )}
                    {r.kind === "debtPayment" && (
                      <select
                        aria-label={"Долг импорта " + (i + 1)}
                        value={r.debtId ?? ""}
                        onChange={(e) =>
                          updateRow(i, { debtId: e.target.value })
                        }
                      >
                        <option value="">Выбери долг</option>
                        {s.debts
                          .filter((d) => d.kind !== "card")
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                      </select>
                    )}
                    {r.kind === "expense" && (
                      <select
                        aria-label={"Категория импорта " + (i + 1)}
                        value={r.categoryId}
                        onChange={(e) =>
                          setRows(
                            rows.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    categoryId: e.target.value,
                                    essential:
                                      s.categories.find(
                                        (c) => c.id === e.target.value,
                                      )?.essential ?? false,
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">Без категории</option>
                        {s.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.duplicateId ? (
                      <label className="duplicate-choice">
                        {r.transferCandidate
                          ? "Возможный второй конец своего перевода"
                          : "Похожая запись уже есть"}
                        <select
                          aria-label={"Решение для повтора " + (i + 1)}
                          value={choices[i] ?? ""}
                          onChange={(e) =>
                            setChoices({ ...choices, [i]: e.target.value })
                          }
                        >
                          <option value="">Выбери действие</option>
                          <option value="skip">
                            {r.transferCandidate
                              ? "Это существующий перевод, связать без новой операции"
                              : "Это та же операция, пропустить"}
                          </option>
                          <option value="new">
                            Это отдельная операция, добавить
                          </option>
                        </select>
                      </label>
                    ) : (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={choices[i] !== "skip"}
                          onChange={(e) =>
                            setChoices({
                              ...choices,
                              [i]: e.target.checked ? "new" : "skip",
                            })
                          }
                        />
                        Добавить
                      </label>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="form-grid">
            <label>
              Период с
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </label>
            <label>
              Период по
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={complete}
              onChange={(e) => setComplete(e.target.checked)}
            />
            Подтверждаю, что файл содержит все операции выбранного счёта за этот
            период
          </label>
          {(errors.length > 0 || rows.some((r) => r.error)) && (
            <label className="check">
              <input
                type="checkbox"
                checked={allowPartial}
                onChange={(e) => setAllowPartial(e.target.checked)}
              />
              Импортировать только корректные строки, история останется неполной
            </label>
          )}
          <p className="hint">
            При выборе «пропустить» существующая запись сохраняется. Одинаковые
            реальные покупки можно добавить отдельно.
          </p>
          <footer>
            <span className="small muted">
              Исходный файл не сохраняется на сервере.
            </span>
            <button
              className="primary"
              disabled={
                busy ||
                unresolved ||
                from > to ||
                !from ||
                !to ||
                ((errors.length > 0 || rows.some((r) => r.error)) &&
                  !allowPartial)
              }
              onClick={confirmImport}
            >
              {busy ? "Добавляем…" : "Подтвердить импорт"}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
