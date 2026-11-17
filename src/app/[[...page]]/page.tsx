import { headers } from "next/headers";
import { auth } from "@/server/auth";
import FinanceApp from "@/components/FinanceApp";
import Login from "@/components/Login";
import { readWorkspace } from "@/server/workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return (
      <Login
        demo={
          Boolean(process.env.LOCAL_DEMO_PASSWORD) &&
          ["http://localhost:3000", "http://127.0.0.1:3000"].includes(
            process.env.BETTER_AUTH_URL ?? "",
          )
        }
      />
    );
  const initialData = await readWorkspace(session.user.id);
  return (
    <FinanceApp
      initialData={initialData}
      name={session.user.name}
      demo={session.user.email === "demo@local.test"}
    />
  );
}
