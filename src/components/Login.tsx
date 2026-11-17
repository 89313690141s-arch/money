"use client";
import { useState, useSyncExternalStore } from "react";
import { ChartNoAxesCombined, ArrowRight, ShieldCheck } from "lucide-react";
export default function Login({ demo }: { demo: boolean }) {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password"),
        }),
      });
      if (!r.ok) throw Error("Не удалось войти. Проверь email и пароль.");
      location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function openDemo() {
    setBusy(true);
    try {
      const r = await fetch("/api/demo", { method: "POST" });
      if (!r.ok) throw Error("Не удалось открыть демо");
      location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login" inert={!hydrated}>
      <section className="login-story">
        <div className="brand">
          <ChartNoAxesCombined /> Личные финансы
        </div>
        <h1>
          У денег
          <br />
          есть план.
        </h1>
        <p>
          Обязательные расходы под контролем.
          <br />
          Долги становятся меньше.
          <br />
          Подушка — больше.
        </p>
        <div className="login-stripes">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span>План месяца · Долги · Накопления</span>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <div className="subtle-icon">
            <ShieldCheck size={26} />
          </div>
          <h2>Твои личные финансы</h2>
          <p className="muted">Войди, чтобы продолжить свой план.</p>
          <form onSubmit={login}>
            <label>
              Email
              <input
                disabled={!hydrated || busy}
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Пароль
              <input
                disabled={!hydrated || busy}
                name="password"
                type="password"
                minLength={12}
                autoComplete="current-password"
                required
                placeholder="Не менее 12 символов"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy || !hydrated} className="primary">
              {busy ? "Подождём…" : "Войти"}
              <ArrowRight size={18} />
            </button>
          </form>
          {demo && (
            <button
              disabled={busy || !hydrated}
              onClick={openDemo}
              className="secondary full demo-login"
            >
              Открыть демо с примерами
            </button>
          )}
          <p className="small muted">
            Личный аккаунт создаётся владельцем при настройке. Демо содержит
            только вымышленные данные.
          </p>
        </div>
      </section>
    </main>
  );
}
