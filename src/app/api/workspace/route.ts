import { auth } from "@/server/auth";
import { readWorkspace, execute } from "@/server/workspace";
import { commandSchema } from "@/domain/commands";
import { z } from "zod";
import { readJson } from "@/server/body";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return Response.json({ error: "Войди в приложение" }, { status: 401 });
  return Response.json(await readWorkspace(session.user.id), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(req: Request) {
  if (
    req.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin
  )
    return Response.json(
      { error: "Недопустимый источник запроса" },
      { status: 403 },
    );
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return Response.json({ error: "Войди в приложение" }, { status: 401 });
  if (Number(req.headers.get("content-length")) > 12 * 1024 * 1024)
    return Response.json({ error: "Файл слишком большой" }, { status: 413 });
  try {
    const body = z
      .object({ version: z.number().int().min(0), command: commandSchema })
      .parse(await readJson(req));
    return Response.json(
      await execute(session.user.id, body.version, body.command),
    );
  } catch (e) {
    const conflict = e instanceof Error && e.message === "CONFLICT";
    return Response.json(
      {
        error: conflict
          ? "Данные изменились в другой вкладке. Обнови страницу и повтори."
          : e instanceof z.ZodError
            ? "Проверь заполненные поля"
            : e instanceof Error && /^[А-ЯЁ]/.test(e.message)
              ? e.message
              : "Не удалось сохранить. Повтори попытку.",
      },
      { status: conflict ? 409 : 400 },
    );
  }
}
