import "dotenv/config";
import { createAuth } from "./owner-auth";
import { db } from "../src/server/db";
import { demoState } from "../src/domain/demo";
import { Prisma } from "../src/generated/prisma/client";
const password = process.env.LOCAL_DEMO_PASSWORD;
if (!password) throw Error("Задай LOCAL_DEMO_PASSWORD в локальном .env");
let owner = await db.user.findUnique({ where: { email: "demo@local.test" } });
if (!owner) {
  const result = await createAuth().api.signUpEmail({
    body: { email: "demo@local.test", password, name: "Демо" },
  });
  owner = await db.user.findUniqueOrThrow({ where: { id: result.user.id } });
}
await db.workspace.upsert({
  where: { ownerId: owner.id },
  create: { ownerId: owner.id, data: demoState() as Prisma.InputJsonValue },
  update: {},
});
console.log("Локальный демо-аккаунт готов. Реальные данные не добавлены.");
await db.$disconnect();
