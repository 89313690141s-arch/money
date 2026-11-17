import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAuth } from "../../scripts/owner-auth";
import { db } from "../../src/server/db";
import { randomUUID } from "node:crypto";
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const users: { id: string; cookie: string }[] = [];
async function request(path: string, cookie = "", body?: unknown) {
  return fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const email = `test-${randomUUID()}@example.test`,
      password = randomUUID() + randomUUID();
    const result = await createAuth().api.signUpEmail({
      body: { email, password, name: "Проверка" },
    });
    const login = await request("/api/auth/sign-in/email", "", {
      email,
      password,
    });
    expect(login.ok).toBe(true);
    const cookie = login.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    users.push({ id: result.user.id, cookie });
  }
}, 60000);
afterAll(async () => {
  for (const u of users) await db.user.deleteMany({ where: { id: u.id } });
  await db.$disconnect();
});
describe("Настоящие API, сессии и PostgreSQL", () => {
  it("анонимный доступ закрыт, публичная регистрация закрыта", async () => {
    expect((await request("/api/workspace")).status).toBe(401);
    expect(
      (
        await request("/api/auth/sign-up/email", "", {
          email: "blocked@example.test",
          password: "LongPassword1234",
          name: "x",
        })
      ).ok,
    ).toBe(false);
  });
  it("счета изолированы, повторный устаревший запрос не меняет данные", async () => {
    const a = users[0],
      b = users[1],
      snapshot = await (await request("/api/workspace", a.cookie)).json();
    const command = {
      type: "account",
      value: {
        id: "private-a",
        name: "Закрытый счёт",
        kind: "debit",
        opening: "100000",
        openingDate: "2026-10-31",
        verifiedDate: "2026-11-17",
      },
    };
    const saved = await request("/api/workspace", a.cookie, {
      version: snapshot.version,
      command,
    });
    expect(saved.status).toBe(200);
    const own = await saved.json();
    expect(own.state.accounts).toHaveLength(1);
    const foreign = await (await request("/api/workspace", b.cookie)).json();
    expect(foreign.state.accounts).toHaveLength(0);
    expect(
      (
        await request("/api/workspace", b.cookie, {
          version: foreign.version,
          command: {
            type: "operation",
            value: {
              id: "bad",
              requestId: "bad",
              date: "2026-11-17",
              kind: "expense",
              accountId: "private-a",
              amount: "100",
              description: "x",
              parts: [
                {
                  categoryId: "food",
                  amount: "100",
                  essential: true,
                  reducible: false,
                },
              ],
            },
          },
        })
      ).status,
    ).toBe(400);
    const parallel = await Promise.all([
      request("/api/workspace", a.cookie, {
        version: own.version,
        command: { ...command, value: { ...command.value, name: "Первый" } },
      }),
      request("/api/workspace", a.cookie, {
        version: own.version,
        command: { ...command, value: { ...command.value, name: "Второй" } },
      }),
    ]);
    expect(parallel.map((r) => r.status).sort()).toEqual([200, 409]);
    const final = await (await request("/api/workspace", a.cookie)).json();
    expect(final.version).toBe(own.version + 1);
  });
  it("отклоняет чужой origin без изменений", async () => {
    const r = await fetch(origin + "/api/workspace", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
        Cookie: users[0].cookie,
      },
      body: "{}",
    });
    expect(r.status).toBe(403);
  });
  it("экспорт включает только свои данные, удаление удаляет сессии", async () => {
    const own = await request("/api/privacy", users[0].cookie, {
      action: "export",
      format: "json",
    });
    expect(own.status).toBe(200);
    expect((await own.json()).accounts).toHaveLength(1);
    const other = await request("/api/privacy", users[1].cookie, {
      action: "export",
      format: "json",
    });
    expect((await other.json()).accounts).toHaveLength(0);
    expect(
      (
        await request("/api/privacy", users[1].cookie, {
          action: "delete",
          confirmation: "неверно",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/privacy", users[1].cookie, {
          action: "delete",
          confirmation: "Удалить мои данные",
        })
      ).ok,
    ).toBe(true);
    expect((await request("/api/workspace", users[1].cookie)).status).toBe(401);
    expect(
      await db.user.findUnique({ where: { id: users[0].id } }),
    ).not.toBeNull();
  });
});
