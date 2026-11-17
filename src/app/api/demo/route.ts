import { auth } from "@/server/auth";
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (
    !process.env.LOCAL_DEMO_PASSWORD ||
    !["http://localhost:3000", "http://127.0.0.1:3000"].includes(
      process.env.BETTER_AUTH_URL ?? "",
    ) ||
    origin !== new URL(process.env.BETTER_AUTH_URL!).origin
  )
    return Response.json({ error: "Демо недоступно" }, { status: 404 });
  return auth.api.signInEmail({
    body: {
      email: "demo@local.test",
      password: process.env.LOCAL_DEMO_PASSWORD,
    },
    headers: req.headers,
    asResponse: true,
  });
}
