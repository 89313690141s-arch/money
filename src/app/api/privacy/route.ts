import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { readWorkspace } from "@/server/workspace";
import { csvExport } from "@/domain/import";
export async function POST(req: Request) {
  if (
    req.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin
  )
    return Response.json({ error: "Недопустимый источник" }, { status: 403 });
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return Response.json({ error: "Войди в приложение" }, { status: 401 });
  if (
    Date.now() - new Date(session.session.createdAt).getTime() >
    10 * 60 * 1000
  )
    return Response.json(
      { error: "Для этой операции выйди и войди снова" },
      { status: 403 },
    );
  const body = await req.json();
  if (body.action === "delete" && body.confirmation === "Удалить мои данные") {
    await db.user.delete({ where: { id: session.user.id } });
    return Response.json({ ok: true });
  }
  if (body.action === "export") {
    const { state } = await readWorkspace(session.user.id);
    return new Response(
      body.format === "csv" ? csvExport(state) : JSON.stringify(state, null, 2),
      {
        headers: {
          "Content-Type":
            body.format === "csv"
              ? "text/csv; charset=utf-8"
              : "application/json",
          "Content-Disposition": `attachment; filename="finance.${body.format === "csv" ? "csv" : "json"}"`,
          "Cache-Control": "no-store",
        },
      },
    );
  }
  return Response.json(
    { error: "Проверь действие и подтверждение" },
    { status: 400 },
  );
}
