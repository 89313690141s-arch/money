"use client";
import { useEffect, useRef, useState } from "react";
import { X, Trash2, Plus } from "lucide-react";
import {
  money,
  today,
  type State,
  type Operation,
  type Account,
  type Debt,
  type PlanItem,
  type Part,
} from "@/domain/types";
import type { Command } from "@/domain/commands";
import { refundParts } from "@/domain/ledger";
import { debtSchedule } from "@/domain/debts";
export type Save = (command: Command) => Promise<boolean>;
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="modal"
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-btn" onClick={close} aria-label="Закрыть">
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
const uid = () => crypto.randomUUID();
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const amount = (f: FormData, k: string) => money(str(f, k));
const decimal = (v?: string) => (v ? (Number(v) / 100).toFixed(2) : "");
function Footer({ busy }: { busy: boolean }) {
  return (
    <footer>
      <span className="small muted">
        Изменения сохранятся в личном аккаунте
      </span>
      <button className="primary" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить"}
      </button>
    </footer>
  );
}
function useForm(save: Save, close: () => void) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(
    e: React.FormEvent<HTMLFormElement>,
    build: (f: FormData) => Command,
  ) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (await save(build(new FormData(e.currentTarget)))) close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}
export function AccountForm({
  s,
  save,
  close,
  value,
}: {
  s: State;
  save: Save;
  close: () => void;
  value?: Account;
}) {
  const [creationId]=useState(()=>value?.id??uid());
  const { error, busy, run } = useForm(save, close);
  return (
    <form
      onSubmit={(e) =>
        run(e, (f) => ({
          type: "account",
          value: {
            id: creationId,
            name: str(f, "name"),
            kind: str(f, "kind") as Account["kind"],
            opening: amount(f, "opening"),
            openingDate: str(f, "openingDate"),
            verifiedDate: str(f, "verifiedDate"),
          },
        }))
      }
    >
      <div className="form-grid">
        <label className="span2">
          Название счёта
          <input
            name="name"
            required
            defaultValue={value?.name}
            placeholder="Например, Т-Банк · основной"
          />
        </label>
        <label>
          Тип счёта
          <select
            aria-label="Тип счёта"
            name="kind"
            defaultValue={value?.kind ?? "debit"}
          >
            <option value="debit">Дебетовый</option>
            <option value="credit">Кредитная карта</option>
            <option value="cushion">Подушка безопасности</option>
            <option value="cash">Наличные</option>
          </select>
        </label>
        <label>
          Начальный остаток, ₽
          <input
            name="opening"
            inputMode="decimal"
            required
            defaultValue={decimal(value?.opening) ?? "0"}
            placeholder="0"
          />
        </label>
        <label>
          Остаток на конец дня
          <input
            name="openingDate"
            type="date"
            required
            defaultValue={value?.openingDate ?? today()}
          />
        </label>
        <label>
          Дата проверки
          <input
            name="verifiedDate"
            type="date"
            required
            defaultValue={value?.verifiedDate ?? today()}
          />
        </label>
      </div>
      <p className="hint">
        Для кредитки задолженность укажи со знаком минус. Операции за день
        начального остатка и ранее уже входят в него.
      </p>
      {s.accounts.length === 0 && (
        <p className="hint">
          После основного счёта добавь отдельный счёт для подушки.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <Footer busy={busy} />
    </form>
  );
}
export function OperationForm({
  s,
  save,
  close,
  value,
  kind: initialKind,
}: {
  s: State;
  save: Save;
  close: () => void;
  value?: Operation;
  kind?: Operation["kind"];
}) {
  const { error, busy, run } = useForm(save, close),
    [identity] = useState(() => ({
      id: value?.id ?? uid(),
      requestId: value?.requestId ?? uid(),
    })),
    [kind, setKind] = useState<Operation["kind"]>(
      value?.kind ?? initialKind ?? "expense",
    ),
    [parts, setParts] = useState<Part[]>(
      value?.parts.length
        ? value.parts
        : [
            {
              categoryId: s.categories[0]?.id ?? "",
              amount: "0",
              essential: s.categories[0]?.essential ?? false,
              reducible: false,
            },
          ],
    ),
    [split, setSplit] = useState((value?.parts.length ?? 0) > 1),
    [original, setOriginal] = useState(value?.refundOf ?? ""),
    [unknown, setUnknown] = useState(value?.principal === undefined),
    [debtId, setDebtId] = useState(value?.debtId ?? "");
  const selectedDebt = s.debts.find((d) => d.id === debtId);
  const paymentDates = selectedDebt ? debtSchedule(selectedDebt, today()) : [];
  if (value?.debtDueDate && !paymentDates.some((p) => p.dueDate === value.debtDueDate))
    paymentDates.push({ dueDate: value.debtDueDate, amount: value.amount });
  const update = (i: number, p: Partial<Part>) =>
    setParts(parts.map((x, j) => (i === j ? { ...x, ...p } : x)));
  return (
    <form
      onSubmit={(e) =>
        run(e, (f) => {
          const total = amount(f, "amount");
          const finalParts = ["expense", "refund"].includes(kind)
            ? kind === "refund"
              ? refundParts(s, original, total, value?.id)
              : split
                ? parts
                : parts.slice(0, 1).map((p) => ({ ...p, amount: total }))
            : [];
          return {
            type: "operation",
            value: {
              ...identity,
              kind,
              date: str(f, "date"),
              amount: total,
              accountId: str(f, "accountId"),
              toAccountId:
                kind === "transfer" ? str(f, "toAccountId") : undefined,
              description: str(f, "description"),
              parts: finalParts,
              planItemId:
                kind === "expense"
                  ? str(f, "planItemId") || undefined
                  : kind === "refund"
                    ? s.operations.find((o) => o.id === original)?.planItemId
                    : undefined,
              debtId: kind === "debtPayment" ? str(f, "debtId") : undefined,
              debtDueDate:
                kind === "debtPayment"
                  ? str(f, "debtDueDate") || undefined
                  : undefined,
              principal:
                kind === "debtPayment" && !unknown
                  ? amount(f, "principal")
                  : undefined,
              interest:
                kind === "debtPayment" && !unknown
                  ? amount(f, "interest")
                  : undefined,
              refundOf: kind === "refund" ? original : undefined,
              importKey: value?.importKey,
            },
          };
        })
      }
    >
      <div className="form-grid">
        <label>
          Тип операции
          <select
            aria-label="Тип операции"
            value={kind}
            onChange={(e) => setKind(e.target.value as Operation["kind"])}
          >
            <option value="expense">Расход</option>
            <option value="income">Доход</option>
            <option value="transfer">Перевод между счетами</option>
            <option value="refund">Возврат покупки</option>
            <option value="debtPayment">Платёж по долгу</option>
          </select>
        </label>
        <label>
          Дата
          <input
            name="date"
            type="date"
            required
            defaultValue={value?.date ?? today()}
          />
        </label>
        <label>
          Сумма, ₽
          <input
            name="amount"
            inputMode="decimal"
            required
            autoFocus
            defaultValue={decimal(value?.amount)}
            placeholder="0,00"
          />
        </label>
        <label>
          Счёт
          <select
            aria-label="Счёт"
            name="accountId"
            defaultValue={value?.accountId}
            required
          >
            <option value="" disabled>
              Выбери счёт
            </option>
            {s.accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {kind === "transfer" && (
          <label className="span2">
            На какой счёт
            <select
              aria-label="На какой счёт"
              name="toAccountId"
              defaultValue={value?.toAccountId}
              required
            >
              <option value="">Выбери счёт</option>
              {s.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "refund" && (
          <label className="span2">
            Исходная покупка
            <select
              aria-label="Исходная покупка"
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              required
            >
              <option value="">Выбери покупку</option>
              {s.operations
                .filter((o) => o.kind === "expense")
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.date} · {o.description} · {decimal(o.amount)} ₽
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === "debtPayment" && (
          <>
            <label className="span2">
              Долг
              <select
                aria-label="Долг"
                name="debtId"
                value={debtId}
                onChange={(e) => setDebtId(e.target.value)}
                required
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
            </label>
            {debtId && (
              <label className="span2">
                Платёж по сроку
                <select
                  key={debtId}
                  name="debtDueDate"
                  defaultValue={
                    value?.debtDueDate ?? ""
                  }
                >
                  <option value="">Автоматически: сначала старые неоплаченные</option>
                  {paymentDates.map((p) => (
                    <option value={p.dueDate} key={p.dueDate}>
                      {p.dueDate}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="check span2">
              <input
                type="checkbox"
                checked={unknown}
                onChange={(e) => setUnknown(e.target.checked)}
              />
              Разбивка тела и процентов пока неизвестна
            </label>
            {!unknown && (
              <>
                <label>
                  Тело платежа, ₽
                  <input
                    name="principal"
                    required
                    defaultValue={decimal(value?.principal)}
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Проценты, ₽
                  <input
                    name="interest"
                    required
                    defaultValue={decimal(value?.interest) ?? "0"}
                    inputMode="decimal"
                  />
                </label>
              </>
            )}
          </>
        )}
        {kind === "expense" && (
          <label className="span2">
            Связанный фиксированный платёж
            <select name="planItemId" defaultValue={value?.planItemId ?? ""}>
              <option value="">Не связан с фиксированным платежом</option>
              {s.plans
                .filter((p) => p.dueDate)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.dueDate} ·{" "}
                    {s.categories.find((c) => c.id === p.categoryId)?.name} ·{" "}
                    {decimal(p.amount)} ₽
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="span2">
          Описание
          <input
            name="description"
            maxLength={300}
            defaultValue={value?.description}
            placeholder="На что ушли деньги"
          />
        </label>
      </div>
      {kind === "expense" && (
        <div className="split-editor">
          <div className="between">
            <h3>Категория</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={split}
                onChange={(e) => setSplit(e.target.checked)}
              />
              Разделить покупку
            </label>
          </div>
          {(split ? parts : parts.slice(0, 1)).map((p, i) => (
            <div className="split-row" key={i}>
              <select
                aria-label={`Категория ${i + 1}`}
                value={p.categoryId}
                onChange={(e) => {
                  const c = s.categories.find((c) => c.id === e.target.value);
                  update(i, {
                    categoryId: e.target.value,
                    essential: c?.essential ?? false,
                  });
                }}
              >
                <option value="">Без категории</option>
                {s.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {split && (
                <input
                  aria-label={`Сумма части ${i + 1}`}
                  inputMode="decimal"
                  placeholder="Сумма, ₽"
                  defaultValue={decimal(p.amount)}
                  onChange={(e) => {
                    try {
                      update(i, { amount: money(e.target.value) });
                    } catch {
                      update(i, { amount: "0" });
                    }
                  }}
                />
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={p.essential}
                  onChange={(e) => update(i, { essential: e.target.checked })}
                />
                Обязательный
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={p.reducible}
                  onChange={(e) => update(i, { reducible: e.target.checked })}
                />
                Можно сократить
              </label>
              {split && i > 0 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Убрать часть"
                  onClick={() => setParts(parts.filter((_, j) => j !== i))}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          {split && (
            <button
              type="button"
              className="text-btn"
              onClick={() =>
                setParts([
                  ...parts,
                  {
                    categoryId: "",
                    amount: "0",
                    essential: false,
                    reducible: false,
                  },
                ])
              }
            >
              <Plus size={15} />
              Добавить часть
            </button>
          )}
        </div>
      )}
      {kind === "transfer" && (
        <p className="hint">
          Перевод на кредитную карту погашает задолженность. Перевод в подушку
          увеличивает накопления. Это не расходы.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Footer busy={busy} />
    </form>
  );
}
export function PlanForm({
  s,
  save,
  close,
  month,
  value,
}: {
  s: State;
  save: Save;
  close: () => void;
  month: string;
  value?: PlanItem;
}) {
  const [creationId]=useState(()=>value?.id??uid());
  const { error, busy, run } = useForm(save, close);
  return (
    <form
      onSubmit={(e) =>
        run(e, (f) => ({
          type: "plan",
          value: {
            id: creationId,
            month,
            categoryId: str(f, "categoryId"),
            amount: amount(f, "amount"),
            dueDate: str(f, "dueDate") || undefined,
          },
        }))
      }
    >
      <div className="form-grid">
        <label className="span2">
          Категория
          <select
            aria-label="Категория"
            required
            name="categoryId"
            defaultValue={value?.categoryId}
          >
            {s.categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name} · {c.essential ? "обязательные" : "необязательные"}
              </option>
            ))}
          </select>
        </label>
        <label>
          План на месяц, ₽
          <input
            required
            inputMode="decimal"
            name="amount"
            defaultValue={decimal(value?.amount)}
            placeholder="0,00"
          />
        </label>
        <label>
          Дата платежа, если фиксированный
          <input
            type="date"
            name="dueDate"
            defaultValue={value?.dueDate}
            min={month + "-01"}
            max={month + "-31"}
          />
        </label>
      </div>
      <p className="hint">
        Оставь дату пустой для переменных расходов, например продуктов.
      </p>
      {error && <p className="error">{error}</p>}
      <Footer busy={busy} />
    </form>
  );
}
export function DebtForm({
  s,
  save,
  close,
  value,
}: {
  s: State;
  save: Save;
  close: () => void;
  value?: Debt;
}) {
  const [creationId]=useState(()=>value?.id??uid());
  const { error, busy, run } = useForm(save, close),
    [kind, setKind] = useState<Debt["kind"]>(value?.kind ?? "loan");
  return (
    <form
      onSubmit={(e) =>
        run(e, (f) => ({
          type: "debt",
          value: {
            id: creationId,
            name: str(f, "name"),
            kind,
            opening: amount(f, "opening"),
            openingDate: str(f, "openingDate"),
            accountId: kind === "card" ? str(f, "accountId") : undefined,
            payment: kind === "card" ? "0" : amount(f, "payment"),
            dueDate: str(f, "dueDate") || today(),
            schedule:
              kind === "card"
                ? undefined
                : str(f, "schedule").trim()
                  ? str(f, "schedule")
                      .trim()
                      .split(/\n+/)
                      .map((line) => {
                        const [dueDate, ...value] = line.trim().split(/\s+/);
                        return { dueDate, amount: money(value.join("")) };
                      })
                  : undefined,
            minimum: kind === "card" ? amount(f, "minimum") : "0",
            minimumDate: str(f, "minimumDate") || today(),
            graceAmount: kind === "card" ? amount(f, "graceAmount") : "0",
            graceDate: str(f, "graceDate") || today(),
            verifiedDate: str(f, "verifiedDate"),
            coveredOperationIds:
              kind === "card"
                ? s.operations
                    .filter(
                      (o) =>
                        o.accountId === str(f, "accountId") &&
                        o.kind === "expense" &&
                        o.date <= str(f, "verifiedDate"),
                    )
                    .map((o) => o.id)
                : [],
            priority: Number(str(f, "priority")),
            rate: str(f, "rate"),
            complete: f.get("complete") === "on",
          },
        }))
      }
    >
      <div className="form-grid">
        <label className="span2">
          Название
          <input
            required
            name="name"
            defaultValue={value?.name}
            placeholder="Например, потребительский кредит"
          />
        </label>
        <label>
          Тип
          <select
            aria-label="Тип"
            value={kind}
            onChange={(e) => setKind(e.target.value as Debt["kind"])}
          >
            <option value="loan">Потребительский кредит</option>
            <option value="card">Кредитная карта</option>
            <option value="personal">Беспроцентный долг</option>
          </select>
        </label>
        <label>
          Начальная задолженность, ₽
          <input
            name="opening"
            inputMode="decimal"
            required
            defaultValue={decimal(value?.opening)}
          />
        </label>
        <label>
          Задолженность на конец дня
          <input
            name="openingDate"
            type="date"
            required
            defaultValue={value?.openingDate ?? today()}
          />
        </label>
        <label>
          Дата сверки с банком
          <input
            name="verifiedDate"
            type="date"
            required
            defaultValue={value?.verifiedDate ?? today()}
          />
        </label>
        {kind === "card" ? (
          <>
            <label className="span2">
              Кредитный счёт
              <select
                aria-label="Кредитный счёт"
                name="accountId"
                required
                defaultValue={value?.accountId}
              >
                <option value="">Выбери счёт</option>
                {s.accounts
                  .filter((a) => a.kind === "credit")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Минимальный платёж, ₽
              <input
                required
                name="minimum"
                inputMode="decimal"
                defaultValue={decimal(value?.minimum) ?? "0"}
              />
            </label>
            <label>
              Срок минимального платежа
              <input
                required
                name="minimumDate"
                type="date"
                defaultValue={value?.minimumDate ?? today()}
              />
            </label>
            <label>
              Для сохранения льготы, ₽
              <input
                required
                name="graceAmount"
                inputMode="decimal"
                defaultValue={decimal(value?.graceAmount) ?? "0"}
              />
            </label>
            <label>
              Срок погашения для льготы
              <input
                required
                name="graceDate"
                type="date"
                defaultValue={value?.graceDate ?? today()}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Платёж в месяц, ₽
              <input
                required
                name="payment"
                inputMode="decimal"
                defaultValue={decimal(value?.payment) ?? "0"}
              />
            </label>
            <label>
              Ближайшая дата платежа
              <input
                required
                name="dueDate"
                type="date"
                defaultValue={value?.dueDate ?? today()}
              />
            </label>
            <label className="span2">
              График из банка — одна строка: ГГГГ-ММ-ДД сумма в ₽
              <textarea
                name="schedule"
                rows={4}
                defaultValue={value?.schedule
                  ?.map((p) => p.dueDate + " " + decimal(p.amount))
                  .join("\n")}
                placeholder="2026-12-24 18500,00"
              />
            </label>
            <label>
              Ставка, % годовых
              <input
                name="rate"
                defaultValue={value?.rate ?? (kind === "personal" ? "0" : "")}
                inputMode="decimal"
              />
            </label>
          </>
        )}
        <label>
          Приоритет погашения
          <input
            name="priority"
            type="number"
            min="0"
            max="100"
            required
            defaultValue={value?.priority ?? 1}
          />
        </label>
        <label className="check span2">
          <input
            type="checkbox"
            name="complete"
            defaultChecked={value?.complete}
          />
          Долг закрыт
        </label>
      </div>
      <p className="hint">
        Суммы и сроки берём из банка. Сверка карты включает покупки до указанной
        даты. После досрочного погашения обнови график по данным банка.
      </p>
      {error && <p className="error">{error}</p>}
      <Footer busy={busy} />
    </form>
  );
}
