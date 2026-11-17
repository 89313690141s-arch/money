"use client";
import { useState, useSyncExternalStore, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  CalendarDays,
  ChartNoAxesCombined,
  Wallet,
  ShieldCheck,
  Landmark,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Upload,
  Download,
  MoreHorizontal,
  LogOut,
  Pencil,
  Trash2,
  Check,
  AlertCircle,
  Search,
  ChevronDown,
  RefreshCw,
  X,
  CircleHelp,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";
import {
  today,
  monthEnd,
  rub,
  money,
  type State,
  type Operation,
  type Account,
  type Debt,
  type PlanItem,
} from "@/domain/types";
import { buildBudget, proposeAllocation } from "@/domain/budget";
import { balanceAt, expenseParts } from "@/domain/ledger";
import { debtBalance, debtRequirements } from "@/domain/debts";
import { summarizeExpenses, periodForMonth } from "@/domain/analytics";
import {
  Modal,
  AccountForm,
  OperationForm,
  PlanForm,
  DebtForm,
  type Save,
} from "./Forms";
import { ImportPanel } from "./ImportPanel";
import type { Command } from "@/domain/commands";
const navigation = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "transactions", label: "Операции", icon: ArrowLeftRight },
  { id: "plan", label: "План месяца", icon: CalendarDays },
  { id: "analytics", label: "Аналитика", icon: ChartNoAxesCombined },
  { id: "debts", label: "Долги", icon: Landmark },
  { id: "cushion", label: "Подушка", icon: ShieldCheck },
  { id: "accounts", label: "Счета и импорт", icon: Wallet },
  { id: "settings", label: "Настройки", icon: Settings },
];
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(m + "-15T12:00:00Z"),
  );
const dateLabel = (d: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
    new Date(d + "T12:00:00Z"),
  );
const uid = () => crypto.randomUUID();
type Editor =
  | { type: "operation"; value?: Operation; kind?: Operation["kind"] }
  | { type: "account"; value?: Account }
  | { type: "debt"; value?: Debt }
  | { type: "plan"; value?: PlanItem }
  | { type: "import" }
  | null;
export default function FinanceApp({
  name,
  demo,
  initialData,
}: {
  name: string;
  demo: boolean;
  initialData: { state: State; version: number };
}) {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const path = usePathname(),
    page = path.split("/")[1] || "overview",
    active = navigation.find((n) => n.id === page) ?? navigation[0];
  const params = useSearchParams();
  const [data, setData] = useState<{ state: State; version: number } | null>(
      initialData,
    ),
    [loadError, setLoadError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState<Editor>(null),
    [more, setMore] = useState(false),
    [month, setMonth] = useState(
      params.get("month") ??
        params.get("date")?.slice(0, 7) ??
        today().slice(0, 7),
    );
  function openEditor(value: Editor) {
    setNotice("");
    setEditor(value);
  }
  const load = useCallback(async function load() {
    try {
      const r = await fetch("/api/workspace", { cache: "no-store" });
      if (r.status === 401) {
        location.reload();
        return;
      }
      if (!r.ok)
        throw Error(
          "Не удалось загрузить данные. Проверь подключение и повтори.",
        );
      setData(await r.json());
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (!editor && !busy) void load();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [load, editor, busy]);
  const save: Save = async (command: Command) => {
    if (!data || busy) return false;
    setBusy(true);
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: data.version, command }),
      });
      const result = await r.json();
      if (!r.ok) {
        if (r.status === 409) await load();
        throw Error(result.error ?? "Не удалось сохранить");
      }
      setData(result);
      setNotice("Изменения сохранены");
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function remove(
    entity:
      | "accounts"
      | "operations"
      | "plans"
      | "debts"
      | "categories"
      | "rules",
    id: string,
  ) {
    if (confirm("Удалить запись? Связанные суммы будут пересчитаны."))
      await save({ type: "remove", entity, id });
  }
  async function logout() {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    location.reload();
  }
  function changeMonth(n: number) {
    const d = new Date(month + "-15T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  }
  const s = data?.state,
    b = s ? buildBudget(s, today()) : null;
  return (
    <div className="app-shell" inert={!hydrated}>
      <aside className="sidebar">
        <Link className="brand" href="/overview">
          <span className="brand-mark">
            <ChartNoAxesCombined size={23} />
          </span>
          <span>
            Личные
            <br />
            финансы
          </span>
        </Link>
        <nav aria-label="Главное меню">
          {navigation.map((n) => (
            <Link
              key={n.id}
              href={"/" + n.id}
              className={page === n.id ? "active" : ""}
            >
              <n.icon size={20} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="priority-note">
            <ShieldCheck size={20} />
            <span>
              Сначала долги.
              <br />
              <strong>Затем — больше свободы.</strong>
            </span>
          </div>
          <button onClick={logout} className="profile">
            <span className="avatar">{name.slice(0, 1)}</span>
            <span>
              {name}
              <small>{demo ? "Демо-аккаунт" : "Личный аккаунт"}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topline">
          <span className="breadcrumb">
            Личный бюджет <span>/</span> {active.label}
          </span>
          <span className="today">
            {dateLabel(today())} <span className="online-dot" /> Личный аккаунт
          </span>
        </div>
        {demo && (
          <div className="demo-banner">
            <CircleHelp size={16} />
            <span>
              Демо с вымышленными данными. Изменения сохраняются отдельно от
              личного бюджета.
            </span>
          </div>
        )}
        <header className="page-header">
          <div>
            <h1>{active.label}</h1>
            <p>
              {(
                {
                  overview: "Каждому рублю — своё место.",
                  transactions: "Вся история денег. Без двойного учёта.",
                  plan: "Сначала обязательное, затем — остальное.",
                  analytics: "Замечай привычки. Решай, что изменить.",
                  debts: "Понятный путь к свободе от долгов.",
                  cushion: "Запас спокойствия на отдельном счёте.",
                  accounts: "Твои деньги и источники операций.",
                  settings: "Настрой бюджет под себя.",
                } as Record<string, string>
              )[page] ?? "Твои личные финансы."}
            </p>
          </div>
          <div className="header-actions">
            {["overview", "plan", "analytics", "transactions"].includes(
              page,
            ) && (
              <div className="month-switch">
                <button
                  aria-label="Предыдущий месяц"
                  onClick={() => changeMonth(-1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>{monthLabel(month)}</span>
                <button
                  aria-label="Следующий месяц"
                  onClick={() => changeMonth(1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
            <button
              className="primary"
              onClick={() =>
                s?.accounts.length
                  ? openEditor({ type: "operation" })
                  : openEditor({ type: "account" })
              }
            >
              <Plus size={18} />
              {s?.accounts.length ? "Операция" : "Добавить счёт"}
            </button>
          </div>
        </header>
        {loadError && (
          <div className="alert">
            <AlertCircle size={18} />
            {loadError}
            <button className="text-btn" onClick={load}>
              Повторить
            </button>
          </div>
        )}
        {!s || !b ? (
          <div className="loading">
            {loadError ? "Данные пока недоступны" : "Загружаем твой бюджет…"}
          </div>
        ) : (
          <>
            {s.accounts.length === 0 && (
              <div className="onboarding">
                <Wallet size={30} />
                <div>
                  <h2>Начнём с того, что есть сейчас</h2>
                  <p>
                    Добавь основной счёт и его остаток, затем долги и план
                    месяца.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => openEditor({ type: "account" })}
                >
                  Добавить первый счёт
                </button>
              </div>
            )}
            {page === "overview" && (
              <>
                <section className="money-board">
                  <div className="board-top">
                    <div>
                      <span className="muted">Можно распределить сейчас</span>
                      <div
                        className={
                          "hero-amount " + (b.available < 0n ? "negative" : "")
                        }
                      >
                        {rub(b.available)}
                      </div>
                      <span className="small muted">
                        {b.preliminary
                          ? "Предварительно · проверь полноту операций"
                          : "По подтверждённым данным"}{" "}
                        <span className="info-dot">i</span>
                      </span>
                    </div>
                    <div className="board-explanation">
                      <span className="status-pill">
                        <span /> Бюджет с приоритетами
                      </span>
                      <p>
                        Резервируем обязательства
                        <br />
                        до {dateLabel(b.horizonEnd)}. Будущий доход
                        <br />
                        ещё не считается полученным.
                      </p>
                    </div>
                  </div>
                  <MoneyStrip b={b} />
                  <div className="money-legend">
                    <div>
                      <i style={{ background: "#385de0" }} />
                      <span>
                        Собственные деньги<strong>{rub(b.cash)}</strong>
                      </span>
                    </div>
                    <div>
                      <i style={{ background: "#c6d0ef" }} />
                      <span>
                        Обязательства<strong>{rub(b.obligations)}</strong>
                      </span>
                    </div>
                    <div>
                      <i style={{ background: "#168475" }} />
                      <span>
                        К переводу в подушку
                        <strong>{rub(b.cushionReserved)}</strong>
                      </span>
                    </div>
                  </div>
                  {b.deficit > 0n && (
                    <div className="deficit">
                      <AlertCircle size={17} />
                      Не хватает {rub(b.deficit)} для покрытия плана. Новые
                      накопления пока не предлагаем.
                    </div>
                  )}
                </section>
                <div className="dashboard-grid">
                  <section className="panel">
                    <div className="section-head">
                      <div>
                        <h2>Расходы по дням</h2>
                        <p>Когда и на что уходят деньги</p>
                      </div>
                      <Link href="/analytics" className="text-btn">
                        Вся аналитика
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    <ExpenseChart s={s} month={month} compact />
                    <div className="chart-key">
                      <span>
                        <i style={{ background: "#385de0" }} />
                        Обязательные
                      </span>
                      <span>
                        <i style={{ background: "#9ab2ec" }} />
                        Необязательные
                      </span>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="section-head">
                      <h2>Ближайшие платежи</h2>
                      <CalendarDays size={19} className="muted" />
                    </div>
                    <div className="payment-list">
                      {b.requirements.length ? (
                        b.requirements
                          .filter((r) => !r.reserveOnly)
                          .slice(0, 4)
                          .map((r) => (
                            <div className="payment-row" key={r.id}>
                              <div
                                className={
                                  "date-square " +
                                  (r.dueDate < today() ? "overdue" : "")
                                }
                              >
                                <strong>{r.dueDate.slice(-2)}</strong>
                                <small>
                                  {new Intl.DateTimeFormat("ru", {
                                    month: "short",
                                  }).format(new Date(r.dueDate + "T12:00:00Z"))}
                                </small>
                              </div>
                              <div>
                                <strong>{r.name}</strong>
                                <small>
                                  {r.dueDate < today()
                                    ? "Просрочено"
                                    : r.estimated
                                      ? "Оценка по плану"
                                      : "По твоему плану"}
                                </small>
                              </div>
                              <b>{rub(r.amount)}</b>
                            </div>
                          ))
                      ) : (
                        <Empty
                          text="Платежей пока нет"
                          detail="Добавь обязательные расходы в план месяца."
                        />
                      )}
                    </div>
                    <Link className="panel-link" href="/plan">
                      Открыть план месяца
                      <ArrowRight size={16} />
                    </Link>
                  </section>
                  <section className="panel">
                    <div className="section-head">
                      <h2>Последние операции</h2>
                      <Link className="text-btn" href="/transactions">
                        Все операции
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    <OperationList
                      s={s}
                      operations={[...s.operations]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .slice(0, 5)}
                      edit={(o) => openEditor({ type: "operation", value: o })}
                    />
                  </section>
                  <section className="cushion-preview">
                    <div className="section-head">
                      <div className="subtle-icon">
                        <ShieldCheck size={23} />
                      </div>
                      <ArrowUpRight size={19} />
                    </div>
                    <h2>Подушка безопасности</h2>
                    <p>
                      Понемногу сейчас.
                      <br />
                      Больше — после закрытия долгов.
                    </p>
                    <strong className="cushion-amount">{rub(b.cushion)}</strong>
                    <Progress
                      value={Number(b.cushion)}
                      max={Number(s.settings.cushionTarget)}
                      color="#168475"
                    />
                    <div className="between small">
                      <span>
                        {Math.min(
                          100,
                          Math.floor(
                            (Number(b.cushion) * 100) /
                              Number(s.settings.cushionTarget),
                          ),
                        )}
                        % цели
                      </span>
                      <span>{rub(s.settings.cushionTarget)}</span>
                    </div>
                    <Link href="/cushion" className="panel-link">
                      Посмотреть накопления
                      <ArrowRight size={16} />
                    </Link>
                  </section>
                </div>
                <IncomeQueue s={s} save={save} busy={busy} />
              </>
            )}
            {page === "transactions" && (
              <Transactions
                s={s}
                month={month}
                edit={(o) => openEditor({ type: "operation", value: o })}
                remove={(id) => remove("operations", id)}
                importFile={() => openEditor({ type: "import" })}
              />
            )}
            {page === "plan" && (
              <>
                <div className="summary-inline">
                  <div>
                    <span>План дохода</span>
                    <strong>{rub(s.settings.expectedIncome)}</strong>
                    <small>Не увеличивает доступные деньги</small>
                  </div>
                  <div>
                    <span>План расходов</span>
                    <strong>
                      {rub(
                        s.plans
                          .filter((p) => p.month === month)
                          .reduce((n, p) => n + BigInt(p.amount), 0n),
                      )}
                    </strong>
                    <small>Обязательные и необязательные</small>
                  </div>
                  <div>
                    <span>Платежи по долгам</span>
                    <strong>
                      {rub(
                        s.debts
                          .flatMap((d) => debtRequirements(s, d, today()))
                          .reduce((n, r) => n + r.amount, 0n),
                      )}
                    </strong>
                    <small>Отдельно от лимитов категорий</small>
                  </div>
                </div>
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h2>План месяца</h2>
                      <p>Планы, реальные траты и оставшиеся суммы</p>
                    </div>
                    <div className="actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          const d = new Date(month + "-15T12:00:00Z");
                          d.setUTCMonth(d.getUTCMonth() - 1);
                          void save({
                            type: "copyPlan",
                            from: d.toISOString().slice(0, 7),
                            to: month,
                          });
                        }}
                      >
                        <RefreshCw size={15} />
                        Из прошлого месяца
                      </button>
                      <button
                        className="primary"
                        onClick={() => openEditor({ type: "plan" })}
                      >
                        <Plus size={17} />
                        Добавить категорию
                      </button>
                    </div>
                  </div>
                  {[true, false].map((essential) => (
                    <div className="plan-group" key={String(essential)}>
                      <h3>
                        <span
                          className={"dot " + (!essential ? "optional" : "")}
                        />
                        {essential
                          ? "Обязательные расходы"
                          : "Необязательные расходы"}
                      </h3>
                      {s.plans
                        .filter(
                          (p) =>
                            p.month === month &&
                            s.categories.some(
                              (c) =>
                                c.id === p.categoryId &&
                                c.essential === essential,
                            ),
                        )
                        .map((p) => {
                          const c = s.categories.find(
                            (c) => c.id === p.categoryId,
                          )!;
                          const actual = s.operations
                            .filter((o) => o.date.startsWith(month))
                            .flatMap(expenseParts)
                            .filter((x) => x.categoryId === p.categoryId)
                            .reduce((n, x) => n + x.value, 0n);
                          return (
                            <div className="plan-row" key={p.id}>
                              <span>
                                <strong>{c.name}</strong>
                                <small>
                                  {p.dueDate
                                    ? dateLabel(p.dueDate)
                                    : "Переменный расход"}
                                </small>
                              </span>
                              <div className="plan-progress">
                                <Progress
                                  value={Number(actual)}
                                  max={Number(p.amount)}
                                  color={
                                    actual > BigInt(p.amount)
                                      ? "#c25b45"
                                      : c.color
                                  }
                                />
                                <small>
                                  {rub(actual)} из {rub(p.amount)}
                                </small>
                              </div>
                              <strong
                                className={
                                  actual > BigInt(p.amount) ? "negative" : ""
                                }
                              >
                                {rub(BigInt(p.amount) - actual)}
                                <small>осталось</small>
                              </strong>
                              <button
                                className="icon-btn"
                                aria-label={"Изменить " + c.name}
                                onClick={() =>
                                  openEditor({ type: "plan", value: p })
                                }
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                className="icon-btn"
                                aria-label={"Удалить план " + c.name}
                                onClick={() => remove("plans", p.id)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  ))}
                  {!s.plans.some((p) => p.month === month) && (
                    <Empty
                      text="Месяц ещё не распланирован"
                      detail="Задай суммы обязательных расходов и лимиты для остальных."
                    />
                  )}
                </section>
              </>
            )}
            {page === "analytics" && <Analytics s={s} month={month} />}
            {page === "debts" && (
              <>
                <div className="section-head">
                  <div>
                    <h2>Три обязательства — один понятный план</h2>
                    <p className="muted">
                      Приоритет досрочного погашения выбираешь ты.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => openEditor({ type: "debt" })}
                  >
                    <Plus size={17} />
                    Добавить долг
                  </button>
                </div>
                <div className="debt-grid">
                  {[...s.debts]
                    .sort((a, b) => a.priority - b.priority)
                    .map((d) => (
                      <section className="panel debt-card" key={d.id}>
                        <div className="between">
                          <span className="tag">
                            {d.kind === "card"
                              ? "Кредитная карта"
                              : d.kind === "loan"
                                ? "Потребительский кредит"
                                : "Беспроцентный долг"}
                          </span>
                          <div className="actions">
                            <button
                              className="icon-btn"
                              aria-label={"Изменить " + d.name}
                              onClick={() =>
                                openEditor({ type: "debt", value: d })
                              }
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="icon-btn"
                              aria-label={"Удалить " + d.name}
                              onClick={() => remove("debts", d.id)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <h2>{d.name}</h2>
                        <div className="debt-amount">
                          {rub(debtBalance(s, d, today()))}
                        </div>
                        <span className="small muted">
                          Остаток задолженности {d.complete ? "· закрыт" : ""}
                        </span>
                        <Progress
                          value={Number(
                            BigInt(d.opening) - debtBalance(s, d, today()),
                          )}
                          max={Number(d.opening)}
                          color="#385de0"
                        />
                        {debtRequirements(s, d, today()).map((r) => (
                          <div className="debt-detail" key={r.id}>
                            <span>
                              {r.name.replace(d.name + " · ", "")}
                              <small>
                                {r.reserveOnly
                                  ? "Срок уточни в банке"
                                  : dateLabel(r.dueDate)}
                              </small>
                            </span>
                            <strong>{rub(r.amount)}</strong>
                          </div>
                        ))}
                        <div className="debt-detail">
                          <span>Приоритет погашения</span>
                          <strong>{d.priority}</strong>
                        </div>
                        <p className="hint">
                          {d.kind === "card"
                            ? "Сумму для сохранения льготы сверяй с банком. Минимальный платёж не заменяет её."
                            : d.kind === "loan"
                              ? "После досрочного платежа обнови график по данным банка."
                              : "Срок возврата не установлен. Платёж задаёшь сам."}
                        </p>
                        <button
                          className="secondary full"
                          onClick={() =>
                            openEditor({
                              type: "operation",
                              kind:
                                d.kind === "card" ? "transfer" : "debtPayment",
                            })
                          }
                        >
                          Записать платёж
                        </button>
                      </section>
                    ))}
                </div>
                <section className="panel">
                  <h2>История погашений</h2>
                  <OperationList
                    s={s}
                    operations={s.operations.filter(
                      (o) =>
                        o.kind === "debtPayment" ||
                        (o.kind === "transfer" &&
                          s.accounts.some(
                            (a) =>
                              a.id === o.toAccountId && a.kind === "credit",
                          )),
                    )}
                    edit={(o) => openEditor({ type: "operation", value: o })}
                  />
                </section>
                {s.operations.some(
                  (o) => o.kind === "debtPayment" && o.principal === undefined,
                ) && (
                  <div className="alert">
                    <AlertCircle size={18} />
                    Есть платежи без разбивки. Уточни тело и проценты, чтобы
                    остаток долга был точным.
                  </div>
                )}
              </>
            )}
            {page === "cushion" && (
              <>
                <section className="cushion-hero">
                  <div>
                    <span className="tag">На отдельном счёте</span>
                    <h2>Подушка безопасности</h2>
                    <div className="hero-amount">{rub(b.cushion)}</div>
                    <p>из {rub(s.settings.cushionTarget)} запланированных</p>
                    <Progress
                      value={Number(b.cushion)}
                      max={Number(s.settings.cushionTarget)}
                      color="#168475"
                    />
                  </div>
                  <div className="cushion-cover">
                    <ShieldCheck size={36} />
                    <strong>
                      {b.essentialMonthly > 0n
                        ? (
                            Number(b.cushion) / Number(b.essentialMonthly)
                          ).toFixed(1)
                        : "—"}
                    </strong>
                    <span>месяца обязательных расходов</span>
                    <small>
                      {b.essentialMonthly > 0n
                        ? "По текущему плану расходов, без погашения долгов"
                        : "Сначала задай обязательные расходы"}
                    </small>
                  </div>
                </section>
                <div className="summary-inline">
                  <div>
                    <span>Откладываем сейчас</span>
                    <strong>{s.settings.cushionBps / 100}%</strong>
                    <small>
                      С каждого поступления при покрытых обязательствах
                    </small>
                  </div>
                  <div>
                    <span>После закрытия долгов</span>
                    <strong>{s.settings.afterDebtBps / 100}%</strong>
                    <small>Переключение только с твоим подтверждением</small>
                  </div>
                  <div>
                    <span>К переводу</span>
                    <strong>{rub(b.cushionReserved)}</strong>
                    <button
                      className="text-btn"
                      onClick={() =>
                        openEditor({ type: "operation", kind: "transfer" })
                      }
                    >
                      Записать перевод
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                </div>
                <IncomeQueue s={s} save={save} busy={busy} />
                <section className="panel">
                  <h2>История пополнений</h2>
                  <OperationList
                    s={s}
                    operations={s.operations.filter(
                      (o) =>
                        o.kind === "transfer" &&
                        s.accounts.some(
                          (a) => a.id === o.toAccountId && a.kind === "cushion",
                        ),
                    )}
                    edit={(o) => openEditor({ type: "operation", value: o })}
                  />
                </section>
              </>
            )}
            {page === "accounts" && (
              <>
                <div className="section-head">
                  <h2>Твои счета</h2>
                  <button
                    className="secondary"
                    onClick={() => openEditor({ type: "account" })}
                  >
                    <Plus size={17} />
                    Добавить счёт
                  </button>
                </div>
                <div className="account-grid">
                  {s.accounts.map((a) => (
                    <section key={a.id} className={"account-card " + a.kind}>
                      <div className="between">
                        <Wallet size={23} />
                        <div className="actions">
                          <button
                            className="icon-btn"
                            aria-label={"Изменить " + a.name}
                            onClick={() =>
                              openEditor({ type: "account", value: a })
                            }
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={"Удалить " + a.name}
                            onClick={() => remove("accounts", a.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <h3>{a.name}</h3>
                      <strong>
                        {rub(balanceAt(a, s.operations, today()))}
                      </strong>
                      <small>
                        Проверено {dateLabel(a.verifiedDate)}
                        {a.kind === "credit"
                          ? " · кредитный лимит не учитываем"
                          : ""}
                      </small>
                    </section>
                  ))}
                </div>
                <section className="import-callout">
                  <div className="subtle-icon">
                    <Upload size={26} />
                  </div>
                  <div>
                    <h2>Импорт операций</h2>
                    <p>Загрузи CSV, проверь записи и подтверди добавление.</p>
                    <p className="small muted">
                      Сейчас доступен тестовый шаблон. Совместимость с реальной
                      выпиской Т-Банка ещё не проверена.
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={!s.accounts.length}
                    onClick={() => openEditor({ type: "import" })}
                  >
                    Загрузить файл
                  </button>
                </section>
                <div className="alert neutral">
                  <CircleHelp size={19} />
                  <span>
                    Автоматический импорт СМС пока не подключён. Подключать
                    платные уведомления сейчас не нужно.
                  </span>
                </div>
              </>
            )}
            {page === "settings" && (
              <SettingsPage s={s} save={save} busy={busy} remove={remove} />
            )}
          </>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Мобильное меню">
        {navigation.slice(0, 4).map((n) => (
          <Link
            href={"/" + n.id}
            key={n.id}
            className={page === n.id ? "active" : ""}
          >
            <n.icon size={21} />
            <span>{n.id === "plan" ? "План" : n.label}</span>
          </Link>
        ))}
        <button
          onClick={() => setMore(!more)}
          className={
            more || navigation.slice(4).some((n) => n.id === page)
              ? "active"
              : ""
          }
        >
          <MoreHorizontal size={22} />
          <span>Ещё</span>
        </button>
      </nav>
      {more && (
        <div className="more-menu">
          <div className="between">
            <h2>Ещё</h2>
            <button
              className="icon-btn"
              aria-label="Закрыть меню"
              onClick={() => setMore(false)}
            >
              <X />
            </button>
          </div>
          {navigation.slice(4).map((n) => (
            <Link key={n.id} href={"/" + n.id} onClick={() => setMore(false)}>
              <n.icon size={20} />
              {n.label}
              <ChevronRight size={17} />
            </Link>
          ))}
          <button className="text-btn" onClick={logout}>
            <LogOut size={18} />
            Выйти
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="toast">
          <span>{notice}</span>
          <button
            className="icon-btn"
            aria-label="Закрыть уведомление"
            onClick={() => setNotice("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {editor && s && (
        <Modal
          title={
            editor.type === "operation"
              ? "Операция"
              : editor.type === "account"
                ? "Счёт"
                : editor.type === "debt"
                  ? "Кредит или долг"
                  : editor.type === "plan"
                    ? "План категории"
                    : "Импорт операций"
          }
          close={() => setEditor(null)}
        >
          {editor.type === "operation" ? (
            <OperationForm
              s={s}
              save={save}
              close={() => setEditor(null)}
              value={editor.value}
              kind={editor.kind}
            />
          ) : editor.type === "account" ? (
            <AccountForm
              s={s}
              save={save}
              close={() => setEditor(null)}
              value={editor.value}
            />
          ) : editor.type === "debt" ? (
            <DebtForm
              s={s}
              save={save}
              close={() => setEditor(null)}
              value={editor.value}
            />
          ) : editor.type === "plan" ? (
            <PlanForm
              s={s}
              save={save}
              close={() => setEditor(null)}
              month={month}
              value={editor.value}
            />
          ) : (
            <ImportPanel s={s} save={save} close={() => setEditor(null)} />
          )}
          {notice && notice !== "Изменения сохранены" && (
            <p role="alert" className="error">
              {notice}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
function Empty({ text, detail }: { text: string; detail?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ChartNoAxesCombined size={24} />
      </div>
      <strong>{text}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
function Progress({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div className="progress">
      <div
        style={{
          width: `${Math.max(0, Math.min(100, max > 0 ? (value * 100) / max : 0))}%`,
          background: color,
        }}
      />
    </div>
  );
}
function MoneyStrip({ b }: { b: ReturnType<typeof buildBudget> }) {
  const total = Number(b.cash > 0n ? b.cash : 1n);
  const reserved = Math.min(100, (Number(b.obligations) * 100) / total),
    cushion = Math.min(
      100 - reserved,
      (Number(b.cushionReserved) * 100) / total,
    );
  return (
    <div
      className="money-strip"
      role="img"
      aria-label="Распределение собственных денег"
    >
      <div style={{ width: reserved + "%", background: "#b7c5eb" }} />
      <div style={{ width: cushion + "%", background: "#168475" }} />
      <div style={{ flex: 1, background: "#385de0" }} />
    </div>
  );
}
function OperationList({
  s,
  operations,
  edit,
  remove,
}: {
  s: State;
  operations: Operation[];
  edit: (o: Operation) => void;
  remove?: (id: string) => void;
}) {
  return operations.length ? (
    <div className="operation-list">
      {operations.map((o) => {
        const cat = s.categories.find((c) => c.id === o.parts[0]?.categoryId),
          isPlus = ["income", "refund"].includes(o.kind);
        return (
          <div className="operation-row" key={o.id}>
            <button onClick={() => edit(o)} className="operation-main">
              <span
                className={
                  "operation-icon " +
                  (isPlus
                    ? "incoming"
                    : o.kind === "transfer"
                      ? "transfer"
                      : "")
                }
                style={
                  cat ? { color: cat.color, background: cat.color + "15" } : {}
                }
              >
                {isPlus ? (
                  <ArrowDownLeft size={19} />
                ) : o.kind === "transfer" ? (
                  <ArrowLeftRight size={19} />
                ) : (
                  <ArrowUpRight size={19} />
                )}
              </span>
              <span>
                <strong>
                  {o.description ||
                    {
                      income: "Доход",
                      expense: "Расход",
                      transfer: "Перевод между счетами",
                      refund: "Возврат покупки",
                      debtPayment: "Платёж по долгу",
                    }[o.kind]}
                </strong>
                <small>
                  {o.kind === "transfer"
                    ? "Перевод"
                    : o.kind === "income"
                      ? "Доход"
                      : o.kind === "debtPayment"
                        ? "Погашение долга"
                        : (cat?.name ?? "Без категории")}{" "}
                  <span>·</span> {dateLabel(o.date)}
                </small>
              </span>
            </button>
            <span className="operation-account">
              {s.accounts.find((a) => a.id === o.accountId)?.name}
            </span>
            <strong className={"operation-sum " + (isPlus ? "positive" : "")}>
              {isPlus ? "+" : o.kind === "transfer" ? "" : "−"}
              {rub(o.amount)}
            </strong>
            {remove && (
              <button
                className="icon-btn"
                aria-label={"Удалить " + (o.description || "операцию")}
                onClick={() => remove(o.id)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  ) : (
    <Empty
      text="Операций пока нет"
      detail="Добавь операцию вручную или загрузи файл."
    />
  );
}
function ExpenseChart({
  s,
  month,
  compact = false,
  filter = "all",
}: {
  s: State;
  month: string;
  compact?: boolean;
  filter?: "all" | "essential" | "optional";
}) {
  const router = useRouter();
  const period = periodForMonth(month, today());
  const a = summarizeExpenses(s, period.from, period.to, filter);
  const points = a.days.map((d) => ({
    date: d.date,
    label: d.date.slice(-2),
    Обязательные: Number(d.essential) / 100,
    Необязательные: Number(d.optional) / 100,
  }));
  return (
    <div className={"chart " + (compact ? "compact" : "")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          barCategoryGap="28%"
          onClick={(e) => {
            const payload = e?.activeLabel;
            if (payload)
              router.push(
                "/transactions?date=" +
                  month +
                  "-" +
                  payload +
                  "&month=" +
                  month +
                  "&essential=" +
                  filter,
              );
          }}
        >
          <CartesianGrid vertical={false} stroke="#edf0f5" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={compact ? 4 : 2}
            tick={{ fill: "#79869a", fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v) => (v >= 1000 ? `${v / 1000}к` : String(v))}
            tickLine={false}
            axisLine={false}
            width={38}
            tick={{ fill: "#79869a", fontSize: 11 }}
          />
          <Tooltip
            formatter={(v) => rub(BigInt(Math.round(Number(v) * 100)))}
            labelFormatter={(v) => `${v} ${monthLabel(month)}`}
            contentStyle={{ borderRadius: 12, border: "1px solid #e4e9f2" }}
          />
          <Bar dataKey="Обязательные" stackId="a" fill="#385de0" />
          <Bar
            dataKey="Необязательные"
            stackId="a"
            fill="#9ab2ec"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function Transactions({
  s,
  month,
  edit,
  remove,
  importFile,
}: {
  s: State;
  month: string;
  edit: (o: Operation) => void;
  remove: (id: string) => void;
  importFile: () => void;
}) {
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all"),
    [category, setCategory] = useState("all");
  const params = useSearchParams();
  const date = params.get("date"),
    weekday = params.get("weekday");
  const operations = s.operations
    .filter(
      (o) =>
        o.date.startsWith(month) &&
        (!date || o.date === date) &&
        (!weekday ||
          (new Date(o.date + "T12:00:00Z").getUTCDay() + 6) % 7 ===
            Number(weekday)) &&
        (type === "all" || o.kind === type) &&
        (!params.get("essential") ||
          params.get("essential") === "all" ||
          expenseParts(o).some((p) =>
            params.get("essential") === "essential"
              ? p.essential
              : !p.essential,
          )) &&
        (category === "all" ||
          o.parts.some((p) => p.categoryId === category)) &&
        o.description.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="panel">
      <div className="filters">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Найти операцию"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти операцию"
          />
        </label>
        <select
          aria-label="Тип операций"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">Все типы</option>
          <option value="expense">Расходы</option>
          <option value="income">Доходы</option>
          <option value="transfer">Переводы</option>
          <option value="refund">Возвраты</option>
          <option value="debtPayment">Погашение долгов</option>
        </select>
        <select
          aria-label="Категория операций"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">Все категории</option>
          <option value="">Без категории</option>
          {s.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={importFile}>
          <Upload size={16} />
          Импорт
        </button>
      </div>
      {(date || weekday) && (
        <div className="filter-notice">
          {date ? "Операции за " + dateLabel(date) : "Выбранный день недели"}
          <Link href="/transactions" className="text-btn">
            Сбросить фильтр
            <X size={14} />
          </Link>
        </div>
      )}
      <OperationList
        s={s}
        operations={operations}
        edit={edit}
        remove={remove}
      />
    </section>
  );
}
function Analytics({ s, month }: { s: State; month: string }) {
  const [filter, setFilter] = useState<"all" | "essential" | "optional">(
    "optional",
  );
  const period = periodForMonth(month, today());
  const a = summarizeExpenses(s, period.from, period.to, filter);
  const top = [...a.weekday].sort((a, b) => Number(b.mean - a.mean))[0];
  return (
    <>
      <div className="analytics-toolbar">
        <div className="segmented">
          {(
            [
              ["optional", "Необязательные"],
              ["essential", "Обязательные"],
              ["all", "Все расходы"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">
          {a.preliminary
            ? "Неполная история · выводы предварительные"
            : "Период полностью покрыт"}
        </span>
      </div>
      <div className="summary-inline">
        <div>
          <span>Расходы за период</span>
          <strong>{rub(a.total)}</strong>
          <small>С учётом возвратов</small>
        </div>
        <div>
          <span>Самый затратный день недели</span>
          <strong>{a.total > 0n ? top.label : "—"}</strong>
          <small>{rub(top.mean)} в среднем за день</small>
        </div>
        <div>
          <span>Ты отметил «можно сократить»</span>
          <strong>{rub(a.reducible)}</strong>
          <small>По твоим отметкам, без предположений</small>
        </div>
      </div>
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Расходы по дням</h2>
            <p>Нажми на столбец, чтобы увидеть покупки</p>
          </div>
        </div>
        <ExpenseChart s={s} month={month} filter={filter} />
      </section>
      <div className="dashboard-grid analytics-lower">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Какие дни обходятся дороже</h2>
              <p>Среднее на календарный день недели</p>
            </div>
          </div>
          <div className="week-chart">
            {a.weekday.map((w) => (
              <Link
                href={
                  "/transactions?weekday=" +
                  w.index +
                  "&month=" +
                  month +
                  "&essential=" +
                  filter
                }
                key={w.label}
                className={w.index === top.index ? "highest" : ""}
              >
                <strong>{rub(w.mean)}</strong>
                <div className="week-column">
                  <i
                    style={{
                      height: `${Math.max(2, (Number(w.mean) * 100) / Math.max(1, Number(top.mean)))}%`,
                    }}
                  />
                </div>
                <b>{w.label}</b>
                <small>{w.occurrences} дней</small>
              </Link>
            ))}
          </div>
          <p className="hint">
            Учитываем число вхождений дня в месяце. Неполная история может
            изменить сравнение.
          </p>
        </section>
        <section className="panel">
          <div className="section-head">
            <h2>На что уходят деньги</h2>
          </div>
          {Object.entries(a.categories)
            .sort((a, b) => Number(b[1] - a[1]))
            .map(([id, value]) => {
              const c = s.categories.find((c) => c.id === id);
              return (
                <div className="category-stat" key={id}>
                  <div className="between">
                    <span>
                      <i style={{ background: c?.color ?? "#9aa5b8" }} />
                      {c?.name ?? "Без категории"}
                    </span>
                    <strong>{rub(value)}</strong>
                  </div>
                  <Progress
                    value={Number(value)}
                    max={Math.max(1, Number(a.total))}
                    color={c?.color ?? "#9aa5b8"}
                  />
                </div>
              );
            })}
          {!Object.keys(a.categories).length && (
            <Empty
              text="Пока нечего сравнивать"
              detail="Добавь расходы за выбранный месяц."
            />
          )}
          <p className="hint">
            Тело погашенных долгов: {rub(a.principal)}. Показываем отдельно от
            расходов на покупки.
          </p>
        </section>
      </div>
      <details className="panel data-table">
        <summary>Данные графика в таблице</summary>
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Обязательные</th>
              <th>Необязательные</th>
              <th>Всего</th>
            </tr>
          </thead>
          <tbody>
            {a.days.map((d) => (
              <tr key={d.date}>
                <td>
                  <Link href={"/transactions?date=" + d.date}>
                    {dateLabel(d.date)}
                  </Link>
                </td>
                <td>{rub(d.essential)}</td>
                <td>{rub(d.optional)}</td>
                <td>{rub(d.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
function IncomeQueue({
  s,
  save,
  busy,
}: {
  s: State;
  save: Save;
  busy: boolean;
}) {
  const incomes = s.operations.filter(
    (o) =>
      o.kind === "income" &&
      o.date <= today() &&
      !s.allocations.some((a) => a.incomeId === o.id),
  );
  if (!incomes.length && !s.allocations.length) return null;
  return (
    <section className="panel income-queue">
      <div className="section-head">
        <div>
          <h2>Распределить поступления</h2>
          <p>Сначала обязательства. Затем подушка и досрочное погашение.</p>
        </div>
      </div>
      {incomes.map((o) => {
        const p = proposeAllocation(s, o.id, today());
        return (
          <form
            className="allocation-row"
            key={o.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                void save({
                  type: "allocate",
                  incomeId: o.id,
                  id: uid(),
                  amount: money(String(f.get("amount"))),
                });
              } catch {
                alert("Проверь сумму накоплений");
              }
            }}
          >
            <span className="operation-icon incoming">
              <ArrowDownLeft size={20} />
            </span>
            <div>
              <strong>{rub(o.amount)}</strong>
              <small>
                {dateLabel(o.date)} · {o.description || "Доход"}
              </small>
            </div>
            <div className="allocation-explanation">
              <span>
                <label className="allocation-input">
                  В подушку, ₽
                  <input
                    name="amount"
                    aria-label={"В подушку из дохода " + o.description}
                    inputMode="decimal"
                    defaultValue={(Number(p.amount) / 100).toFixed(2)}
                    required
                  />
                </label>
              </span>
              <small>
                {p.deficit > 0n
                  ? "Сначала покрой нехватку по обязательствам"
                  : "Остаток доступен для выбранного долга и трат"}
              </small>
            </div>
            <button className="secondary" disabled={busy}>
              <Check size={16} />
              Подтвердить
            </button>
          </form>
        );
      })}
      {s.allocations.length > 0 && (
        <details className="confirmed-allocations">
          <summary>
            Подтверждённые распределения ({s.allocations.length})
          </summary>
          {s.allocations.map((a) => (
            <div key={a.id} className="between">
              <span>
                {dateLabel(a.createdDate)} · {rub(a.amount)} в подушку
              </span>
              <button
                className="text-btn"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Отменить план этого распределения? Фактические переводы останутся.",
                    )
                  )
                    void save({ type: "cancelAllocation", id: a.id });
                }}
              >
                Отменить план
              </button>
            </div>
          ))}
          <p className="hint">
            Отмена меняет резерв, фактические банковские переводы остаются в
            истории.
          </p>
        </details>
      )}
    </section>
  );
}
function SettingsPage({
  s,
  save,
  busy,
  remove,
}: {
  s: State;
  save: Save;
  busy: boolean;
  remove: (entity: "categories" | "rules", id: string) => void;
}) {
  const [error, setError] = useState(""),
    [category, setCategory] = useState(""),
    [essential, setEssential] = useState(false);
  async function exportData(format: string) {
    const r = await fetch("/api/privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "export", format }),
    });
    if (!r.ok) {
      setError((await r.json()).error);
      return;
    }
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = "finance." + format;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Доход и накопления</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await save({
                type: "settings",
                value: {
                  expectedIncome: money(String(f.get("income"))),
                  cushionTarget: money(String(f.get("target"))),
                  cushionBps: Math.round(Number(f.get("before")) * 100),
                  afterDebtBps: Math.round(Number(f.get("after")) * 100),
                  higherRateConfirmed: f.get("higher") === "on",
                },
              });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="form-grid">
            <label>
              План дохода, ₽
              <input
                name="income"
                inputMode="decimal"
                required
                defaultValue={Number(s.settings.expectedIncome) / 100}
              />
            </label>
            <label>
              Цель подушки, ₽
              <input
                name="target"
                inputMode="decimal"
                required
                defaultValue={Number(s.settings.cushionTarget) / 100}
              />
            </label>
            <label>
              Пока есть долги, %
              <input
                name="before"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={s.settings.cushionBps / 100}
              />
            </label>
            <label>
              После закрытия долгов, %
              <input
                name="after"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={s.settings.afterDebtBps / 100}
              />
            </label>
            <label className="check span2">
              <input
                name="higher"
                type="checkbox"
                disabled={s.debts.some(
                  (d) => debtBalance(s, d, today()) > 0n && !d.complete,
                )}
                defaultChecked={s.settings.higherRateConfirmed}
              />
              Долги закрыты, применить повышенный процент
            </label>
          </div>
          <button className="primary" disabled={busy}>
            Сохранить настройки
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Категории</h2>
        <div className="settings-categories">
          {s.categories.map((c) => (
            <div className="between" key={c.id}>
              <span>
                <i style={{ background: c.color }} />
                {c.name}
                <small>{c.essential ? "Обязательные" : "Необязательные"}</small>
              </span>
              <button
                className="icon-btn"
                aria-label={"Удалить категорию " + c.name}
                onClick={() => remove("categories", c.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await save({
                type: "category",
                value: {
                  id: uid(),
                  name: category,
                  essential,
                  color: "#7589bd",
                },
              })
            )
              setCategory("");
          }}
        >
          <label>
            Новая категория
            <input
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Название"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={essential}
              onChange={(e) => setEssential(e.target.checked)}
            />
            Обязательный расход
          </label>
          <button className="secondary" disabled={busy}>
            Добавить категорию
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Правила импорта</h2>
        <p className="muted small">
          Подставляем категорию по тексту описания. Результат можно изменить до
          импорта.
        </p>
        {s.rules.map((r) => (
          <div key={r.id} className="between">
            <span>
              {r.contains} →{" "}
              {s.categories.find((c) => c.id === r.categoryId)?.name}
            </span>
            <button
              className="icon-btn"
              aria-label="Удалить правило"
              onClick={() => remove("rules", r.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await save({
              type: "rule",
              id: uid(),
              contains: String(f.get("contains")),
              categoryId: String(f.get("category")),
            });
          }}
        >
          <label>
            Описание содержит
            <input name="contains" required placeholder="Например, магазин" />
          </label>
          <label>
            Категория
            <select name="category">
              {s.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" disabled={busy}>
            Сохранить правило
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Данные и доступ</h2>
        <p className="muted">
          Скачай копию данных. Для экспорта и удаления нужен недавний вход.
        </p>
        <div className="actions wrap">
          <button className="secondary" onClick={() => exportData("json")}>
            <Download size={16} />
            Экспорт JSON
          </button>
          <button className="secondary" onClick={() => exportData("csv")}>
            <Download size={16} />
            Экспорт CSV
          </button>
        </div>
        <hr />
        <h3>Установка на iPhone</h3>
        <p className="small muted">
          Открой приложение в Safari, нажми «Поделиться», затем «На экран
          Домой». Для доступа с телефона потребуется размещение по HTTPS.
        </p>
        <hr />
        <h3>Удаление аккаунта</h3>
        <p className="small muted">
          Удалятся счета, операции, планы и сессии. Резервные копии очищаются по
          сроку хранения хостинга.
        </p>
        <button
          className="danger"
          onClick={async () => {
            const confirmation = prompt(
              "Для удаления введи: Удалить мои данные",
            );
            if (confirmation !== "Удалить мои данные") return;
            const r = await fetch("/api/privacy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", confirmation }),
            });
            if (r.ok) location.reload();
            else setError((await r.json()).error);
          }}
        >
          Удалить аккаунт и данные
        </button>
      </section>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
    </div>
  );
}
