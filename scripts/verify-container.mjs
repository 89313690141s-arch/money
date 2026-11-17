import "dotenv/config";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { Client } from "pg";
const image = "personal-finance:local",
  network = "personal-finance_default",
  suffix = Date.now().toString(),
  database = "finance_restore_docker_" + suffix,
  container = "finance-smoke-" + suffix;
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const connection = new URL(process.env.DATABASE_URL),
  admin = new Client({ connectionString: connection.toString() });
await admin.connect();
connection.hostname = "db";
connection.port = "5432";
connection.pathname = "/" + database;
const baseURL = "http://localhost:" + port;
const env = {
  ...process.env,
  DATABASE_URL: connection.toString(),
  BETTER_AUTH_URL: baseURL,
  LOCAL_DEMO_PASSWORD: randomBytes(32).toString("hex"),
  BACKUP_DIRECTORY: "/tmp/finance-backups",
};
const flags = [
  "--network",
  network,
  ...[
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "LOCAL_DEMO_PASSWORD",
    "BACKUP_KEY",
    "BACKUP_DIRECTORY",
  ].flatMap((key) => ["--env", key]),
];
function docker(args) {
  const r = spawnSync("docker", args, {
    env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw Error(
      "Контейнерная проверка не прошла: " +
        args.filter((v) => !v.startsWith("postgresql:")).join(" ") +
        "\n" +
        r.stderr,
    );
  return r.stdout;
}
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  docker([
    "run",
    "--rm",
    ...flags,
    image,
    "node",
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
  ]);
  docker([
    "run",
    "--rm",
    ...flags,
    image,
    "node",
    "node_modules/tsx/dist/cli.mjs",
    "scripts/create-demo.ts",
  ]);
  docker(["run", "--rm", ...flags, image, "node", "scripts/backup.mjs"]);
  docker([
    "run",
    "-d",
    "--name",
    container,
    ...flags,
    "-p",
    `127.0.0.1:${port}:3000`,
    image,
  ]);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(baseURL)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw Error("Сервер контейнера не запустился");
  const login = await fetch(baseURL + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { Origin: baseURL, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "demo@local.test",
      password: env.LOCAL_DEMO_PASSWORD,
    }),
  });
  if (!login.ok) throw Error("Не прошёл вход в контейнере");
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const response = await fetch(baseURL + "/api/workspace", {
    headers: { Cookie: cookie },
  });
  const snapshot = await response.json();
  if (!response.ok || snapshot.state.accounts.length !== 3)
    throw Error("Нет сохранённых данных контейнера");
  console.log(
    "Контейнер: миграция, создание аккаунта, вход, PostgreSQL, чтение данных и зашифрованный pg_dump — PASS",
  );
} finally {
  spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  if (!/^finance_restore_docker_\d+$/.test(database))
    throw Error("Invalid cleanup database");
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
}
