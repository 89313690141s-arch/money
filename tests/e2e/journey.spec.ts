import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createAuth } from "../../scripts/owner-auth";
import { db } from "../../src/server/db";
import { today, addDays } from "../../src/domain/types";
import { buildBudget } from "../../src/domain/budget";
const ownerIds: string[] = [];
test.afterAll(async () => {
  for (const id of ownerIds) await db.user.deleteMany({ where: { id } });
  await db.$disconnect();
});
async function done(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
test("с нуля: счета, месячный план, три долга, доход, подушка, платёж и аналитика", async ({
  page,
}) => {
  test.setTimeout(120000);
  const email = `journey-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID(),
    date = today();
  const result = await createAuth().api.signUpEmail({
    body: { email, password, name: "Проверка сценария" },
  });
  ownerIds.push(result.user.id);
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Обзор", level: 1 }),
  ).toBeVisible();
  for (const [name, kind, opening] of [
    ["Основной", "debit", "50000"],
    ["Подушка", "cushion", "0"],
    ["Кредитка", "credit", "-10000"],
  ]) {
    await page.goto("/accounts");
    await page
      .getByRole("button", { name: "Добавить счёт", exact: true })
      .last()
      .click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Название счёта").fill(name);
    await d.getByLabel("Тип счёта").selectOption(kind);
    await d.getByLabel("Начальный остаток, ₽").fill(opening);
    await d.getByLabel("Остаток на конец дня").fill(addDays(date, -1));
    await done(page);
  }
  await page.goto("/plan");
  for (const [category, amount, due] of [
    ["home", "10000", date],
    ["cafe", "5000", ""],
  ]) {
    await page
      .getByRole("button", { name: "Добавить категорию", exact: true })
      .click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Категория", { exact: true }).selectOption(category);
    await d.getByLabel("План на месяц, ₽").fill(amount);
    if (due) await d.getByLabel("Дата платежа, если фиксированный").fill(due);
    await done(page);
  }
  await page.goto("/debts");
  for (const [name, kind, opening, payment] of [
    ["Карта", "card", "10000", "0"],
    ["Кредит", "loan", "100000", "10000"],
    ["Долг", "personal", "20000", "1000"],
  ]) {
    await page.getByRole("button", { name: "Добавить долг" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Название", { exact: true }).fill(name);
    await d.getByLabel("Тип", { exact: true }).selectOption(kind);
    await d.getByLabel("Начальная задолженность, ₽").fill(opening);
    await d.getByLabel("Задолженность на конец дня").fill(addDays(date, -1));
    if (kind === "card") {
      await d.getByLabel("Кредитный счёт").selectOption({ label: "Кредитка" });
      await d.getByLabel("Минимальный платёж, ₽").fill("500");
      await d.getByLabel("Для сохранения льготы, ₽").fill("10000");
    } else {
      await d.getByLabel("Платёж в месяц, ₽").fill(payment);
    }
    await done(page);
  }
  await page.goto("/settings");
  await page.locator(".app-shell:not([inert])").waitFor();
  await page.getByLabel("Пока есть долги, %").fill("5");
  await page.getByLabel("После закрытия долгов, %").fill("20");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/workspace") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Сохранить настройки" }).click(),
  ]);
  expect(
    (await (await page.request.get("/api/workspace")).json()).state.settings
      .cushionBps,
  ).toBe(500);
  await expect(page.getByRole("status")).toContainText("Изменения сохранены");
  await page.getByRole("button", { name: "Операция", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Тип операции").selectOption("income");
  await d.getByLabel("Сумма, ₽", { exact: true }).fill("20000");
  await d
    .getByLabel("Счёт", { exact: true })
    .selectOption({ label: "Основной" });
  await d.getByLabel("Описание", { exact: true }).fill("Первая часть дохода");
  await done(page);
  await page.goto("/overview");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/workspace") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Подтвердить", exact: true }).click(),
  ]);
  let snapshot = await (await page.request.get("/api/workspace")).json();
  expect(snapshot.state.allocations[0].amount).toBe("100000");
  expect(buildBudget(snapshot.state, date).cushion).toBe(0n);
  await page.getByRole("button", { name: "Операция", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Тип операции").selectOption("transfer");
  await d.getByLabel("Сумма, ₽", { exact: true }).fill("1000");
  await d
    .getByLabel("Счёт", { exact: true })
    .selectOption({ label: "Основной" });
  await d.getByLabel("На какой счёт").selectOption({ label: "Подушка" });
  await done(page);
  snapshot = await (await page.request.get("/api/workspace")).json();
  expect(buildBudget(snapshot.state, date).cushion).toBe(100000n);
  expect(buildBudget(snapshot.state, date).cushionReserved).toBe(0n);
  await page.getByRole("button", { name: "Операция", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Тип операции").selectOption("debtPayment");
  await d.getByLabel("Сумма, ₽", { exact: true }).fill("10000");
  await d
    .getByLabel("Счёт", { exact: true })
    .selectOption({ label: "Основной" });
  await d.getByLabel("Долг", { exact: true }).selectOption({ label: "Кредит" });
  await d.getByLabel("Разбивка тела и процентов пока неизвестна").uncheck();
  await d.getByLabel("Тело платежа, ₽").fill("8000");
  await d.getByLabel("Проценты, ₽").fill("2000");
  await done(page);
  await page.goto("/analytics");
  await page.getByRole("button", { name: "Все расходы", exact: true }).click();
  await expect(
    page.getByText("Проценты и комиссии", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Сб/ }).click();
  await expect(page).toHaveURL(/weekday=5.*month=/);
  await expect(
    page.getByRole("heading", { name: "Операции", level: 1 }),
  ).toBeVisible();
  snapshot = await (await page.request.get("/api/workspace")).json();
  expect(
    snapshot.state.operations.filter(
      (o: { kind: string }) => o.kind === "debtPayment",
    ),
  ).toHaveLength(1);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Загрузить файл" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Счёт импорта").selectOption({ label: "Кредитка" });
  await d
    .getByLabel("Выбрать CSV-файл")
    .setInputFiles({
      name: "credit.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Дата;Сумма;Описание;ID\n${date};1000,00;Погашение кредитки;credit-payment`,
      ),
    });
  await d
    .getByLabel("Другой счёт импорта 1")
    .selectOption({ label: "Основной" });
  await d.getByRole("button", { name: "Подтвердить импорт" }).click();
  await expect(d).not.toBeVisible();
  snapshot = await (await page.request.get("/api/workspace")).json();
  const imported = snapshot.state.operations.find(
    (o: { description: string }) => o.description === "Погашение кредитки",
  );
  expect(imported.kind).toBe("transfer");
  expect(imported.toAccountId).toBe(
    snapshot.state.accounts.find((a: { name: string }) => a.name === "Кредитка")
      .id,
  );
});
