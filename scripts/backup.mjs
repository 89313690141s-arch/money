import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const directory = process.env.BACKUP_DIRECTORY ?? "backups";
const key = Buffer.from(process.env.BACKUP_KEY ?? "", "hex");
if (key.length !== 32)
  throw Error("BACKUP_KEY должен содержать 64 шестнадцатеричных символа");
const local = process.argv.includes("--docker");
function run(command, args, options = {}) {
  const r = spawnSync(command, args, {
    maxBuffer: 512 * 1024 * 1024,
    ...options,
  });
  if (r.error || r.status !== 0)
    throw Error(
      "Операция резервного копирования не выполнена. Проверь доступность PostgreSQL и права.",
    );
  return r.stdout;
}
function connection() {
  const u = new URL(process.env.DATABASE_URL);
  return {
    args: [
      "-h",
      u.hostname,
      "-p",
      u.port || "5432",
      "-U",
      decodeURIComponent(u.username),
    ],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
    database: u.pathname.slice(1),
  };
}
function dump() {
  if (local)
    return run("docker", [
      "compose",
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "finance",
      "-d",
      "finance",
      "-Fc",
    ]);
  const c = connection();
  return run("pg_dump", [...c.args, "-d", c.database, "-Fc"], { env: c.env });
}
export function backup() {
  fs.mkdirSync(directory, { recursive: true });
  const data = dump(),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv),
    encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const filename = path.join(
    directory,
    "finance-" + new Date().toISOString().replaceAll(":", "-") + ".enc",
  );
  fs.writeFileSync(
    filename,
    Buffer.concat([Buffer.from("FIN1"), iv, cipher.getAuthTag(), encrypted]),
    { mode: 0o600 },
  );
  for (const name of fs.readdirSync(directory)) {
    if (!/^finance-.*\.enc$/.test(name)) continue;
    const p = path.join(directory, name);
    if (Date.now() - fs.statSync(p).mtimeMs > 30 * 86400000) fs.unlinkSync(p);
  }
  console.log("Зашифрованная копия создана:", filename);
  return filename;
}
if (process.argv.includes("--restore")) {
  const index = process.argv.indexOf("--restore"),
    file = process.argv[index + 1],
    database = process.argv[index + 2];
  if (!/^finance_restore_[a-z0-9_]+$/.test(database ?? ""))
    throw Error(
      "Восстановление разрешено только в отдельную finance_restore_* базу",
    );
  const envelope = fs.readFileSync(file);
  if (envelope.subarray(0, 4).toString() !== "FIN1")
    throw Error("Неверный формат копии");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    envelope.subarray(4, 16),
  );
  decipher.setAuthTag(envelope.subarray(16, 32));
  const bytes = Buffer.concat([
    decipher.update(envelope.subarray(32)),
    decipher.final(),
  ]);
  if (local) {
    run("docker", [
      "compose",
      "exec",
      "-T",
      "db",
      "createdb",
      "-U",
      "finance",
      database,
    ]);
    run(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "db",
        "pg_restore",
        "-U",
        "finance",
        "-d",
        database,
        "--exit-on-error",
      ],
      { input: bytes },
    );
  } else {
    const c = connection();
    run("createdb", [...c.args, database], { env: c.env });
    run("pg_restore", [...c.args, "-d", database, "--exit-on-error"], {
      env: c.env,
      input: bytes,
    });
  }
  console.log("Восстановлено в отдельную базу:", database);
} else {
  backup();
  if (process.argv.includes("--daily"))
    setInterval(() => {
      try {
        backup();
      } catch {
        console.error("Не удалось создать ежедневную резервную копию");
        process.exit(1);
      }
    }, 86400000);
}
