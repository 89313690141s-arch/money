import { emptyState, today, addDays, monthEnd, type State } from "./types";
export function demoState(): State {
  const s = emptyState(),
    date = today(),
    month = date.slice(0, 7),
    start = month + "-01",
    last = monthEnd(date);
  s.settings = {
    expectedIncome: "20000000",
    cushionBps: 500,
    afterDebtBps: 2000,
    cushionTarget: "45000000",
    higherRateConfirmed: false,
  };
  s.accounts = [
    {
      id: "debit",
      name: "Т-Банк · основной",
      kind: "debit",
      opening: "14780000",
      openingDate: addDays(start, -1),
      verifiedDate: date,
    },
    {
      id: "card",
      name: "Т-Банк · кредитная карта",
      kind: "credit",
      opening: "-3820000",
      openingDate: addDays(start, -1),
      verifiedDate: date,
    },
    {
      id: "save",
      name: "Подушка безопасности",
      kind: "cushion",
      opening: "3200000",
      openingDate: addDays(start, -1),
      verifiedDate: date,
    },
  ];
  const amounts = [
    ["food", "2500000"],
    ["home", "3000000"],
    ["transport", "800000"],
    ["cafe", "1200000"],
    ["shopping", "1500000"],
    ["leisure", "1000000"],
  ];
  s.plans = amounts.map(([categoryId, amount]) => ({
    id: "plan-" + categoryId,
    month,
    categoryId,
    amount,
    dueDate: categoryId === "home" ? month + "-25" : undefined,
  }));
  for (let n = 0; n < Number(date.slice(-2)); n++) {
    const d = addDays(start, n),
      w = new Date(d + "T12:00:00Z").getUTCDay();
    const categoryId = n % 3 === 0 ? "food" : w === 6 ? "shopping" : "cafe";
    const c = s.categories.find((c) => c.id === categoryId)!;
    s.operations.push({
      id: "demo-" + n,
      requestId: "demo-" + n,
      kind: "expense",
      date: d,
      accountId: "debit",
      amount: ((w === 6 ? 4850 : 320 + n * 69) * 100).toString(),
      description:
        categoryId === "food"
          ? "Продукты на неделю"
          : categoryId === "shopping"
            ? "Покупки для дома"
            : "Кофе и обед",
      parts: [
        {
          categoryId,
          essential: c.essential,
          reducible: false,
          amount: ((w === 6 ? 4850 : 320 + n * 69) * 100).toString(),
        },
      ],
    });
  }
  s.operations.push({
    id: "income-demo",
    requestId: "income-demo",
    kind: "income",
    date,
    accountId: "debit",
    amount: "5000000",
    description: "Поступление дохода",
    parts: [],
  });
  s.debts = [
    {
      id: "credit-card",
      name: "Кредитная карта",
      kind: "card",
      opening: "3820000",
      openingDate: addDays(start, -1),
      accountId: "card",
      payment: "0",
      dueDate: month + "-25",
      minimum: "250000",
      minimumDate: month + "-22",
      graceAmount: "3820000",
      graceDate: month + "-28",
      verifiedDate: date,
      coveredOperationIds: [],
      priority: 1,
      rate: "",
      complete: false,
    },
    {
      id: "loan",
      name: "Потребительский кредит",
      kind: "loan",
      opening: "28640000",
      openingDate: addDays(start, -1),
      payment: "1850000",
      dueDate: month + "-24",
      minimum: "0",
      minimumDate: last,
      graceAmount: "0",
      graceDate: last,
      verifiedDate: date,
      coveredOperationIds: [],
      priority: 2,
      rate: "22",
      complete: false,
    },
    {
      id: "personal",
      name: "Беспроцентный долг",
      kind: "personal",
      opening: "6000000",
      openingDate: addDays(start, -1),
      payment: "500000",
      dueDate: last,
      minimum: "0",
      minimumDate: last,
      graceAmount: "0",
      graceDate: last,
      verifiedDate: date,
      coveredOperationIds: [],
      priority: 3,
      rate: "0",
      complete: false,
    },
  ];
  s.coverage = [
    { accountId: "debit", from: start, to: date, complete: true },
    { accountId: "card", from: start, to: date, complete: true },
  ];
  return s;
}
