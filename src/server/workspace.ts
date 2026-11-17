import { db } from "./db";
import { emptyState, stateSchema } from "@/domain/types";
import { applyCommand, type Command } from "@/domain/commands";
import { Prisma } from "@/generated/prisma/client";
export async function readWorkspace(ownerId: string) {
  const row = await db.workspace.upsert({
    where: { ownerId },
    create: { ownerId, data: emptyState() as Prisma.InputJsonValue },
    update: {},
  });
  return { state: stateSchema.parse(row.data), version: row.version };
}
export async function execute(
  ownerId: string,
  version: number,
  command: Command,
) {
  return db.$transaction(async (tx) => {
    const row = await tx.workspace.findUnique({ where: { ownerId } });
    if (!row) throw Error("Рабочая область не найдена");
    if (row.version !== version) throw Error("CONFLICT");
    const next = applyCommand(stateSchema.parse(row.data), command);
    const result = await tx.workspace.updateMany({
      where: { ownerId, version },
      data: { data: next as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    if (result.count !== 1) throw Error("CONFLICT");
    return { state: next, version: version + 1 };
  });
}
