import { test, expect } from "@playwright/test";
test("восемь страниц, сохранение и мобильная навигация", async ({
  page,
}, testInfo) => {
  const suffix = Date.now().toString();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  if (
    await page
      .getByRole("button", { name: "Открыть демо с примерами" })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Открыть демо с примерами" })
      .click();
  await expect(
    page.getByRole("heading", { name: "Обзор", exact: true }),
  ).toBeVisible();
  await page.locator(".recharts-surface").first().waitFor();
  await page.screenshot({
    path: `outputs/${testInfo.project.name}-overview.png`,
    fullPage: true,
    scale: "css",
  });
  for (const [route, title] of [
    ["transactions", "Операции"],
    ["plan", "План месяца"],
    ["analytics", "Аналитика"],
    ["debts", "Долги"],
    ["cushion", "Подушка"],
    ["accounts", "Счета и импорт"],
    ["settings", "Настройки"],
  ]) {
    await page.goto("/" + route);
    await expect(
      page.getByRole("heading", { name: title, exact: true, level: 1 }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Операция", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Сумма, ₽", { exact: true }).fill("123,45");
  await dialog
    .getByLabel("Описание", { exact: true })
    .fill("Проверка интерфейса " + testInfo.project.name + suffix);
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Проверка интерфейса " + testInfo.project.name + suffix, {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Проверка интерфейса " + testInfo.project.name + suffix, {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/analytics");
  await page.screenshot({
    path: `outputs/${testInfo.project.name}-analytics.png`,
    fullPage: true,
    scale: "css",
  });
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page
      .locator(".more-menu")
      .getByRole("link", { name: "Долги", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Долги", level: 1 }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
test("предпросмотр импорта и повторная загрузка не создают дубликат", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  if (
    await page
      .getByRole("button", { name: "Открыть демо с примерами" })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Открыть демо с примерами" })
      .click();
  await expect(
    page.getByRole("heading", { name: "Обзор", level: 1 }),
  ).toBeVisible();
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Загрузить файл" }).click();
  const dialog = page.getByRole("dialog");
  const description = "Импорт сценарий " + testInfo.project.name + Date.now();
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
  }).format(new Date());
  const csv = `Дата;Сумма;Описание;ID\n${date};-123,45;${description};e2e-${description}\n${date};-200,00;Пропущенная строка;skip-${description}`;
  await dialog.getByLabel("Выбрать CSV-файл").setInputFiles({
    name: "test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(dialog.getByText(description, { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox',{name:'Добавить',exact:true}).nth(1).uncheck();
  await dialog.getByRole('checkbox',{name:/Подтверждаю, что файл/}).check();
  await dialog.getByRole("button", { name: "Подтвердить импорт" }).click();
  await expect(dialog).not.toBeVisible();
  const snapshot=await (await page.request.get('/api/workspace')).json();
  expect(snapshot.state.coverage.at(-1).complete).toBe(false);
  await page.goto("/transactions");
  await expect(page.getByText(description, { exact: true })).toHaveCount(1);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Загрузить файл" }).click();
  await page.getByLabel("Выбрать CSV-файл").setInputFiles({
    name: "test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByLabel("Решение для повтора 1").selectOption("skip");
  await page.getByRole('checkbox',{name:'Добавить',exact:true}).uncheck();
  await page.getByRole("button", { name: "Подтвердить импорт" }).click();
  await page.goto("/transactions");
  await expect(page.getByText(description, { exact: true })).toHaveCount(1);
});
