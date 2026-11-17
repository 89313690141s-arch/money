import "dotenv/config";
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
it("восстанавливает зашифрованную копию в отдельную базу с теми же данными", async () => {
  const original = new Client({ connectionString: process.env.DATABASE_URL });
  await original.connect();
  const query =
    'SELECT "ownerId",version,data FROM "Workspace" ORDER BY "ownerId"';
  const before = (await original.query(query)).rows;
  const backup = spawnSync(
    process.execPath,
    ["--env-file=.env", "scripts/backup.mjs", "--docker"],
    { encoding: "utf8" },
  );
  expect(backup.status).toBe(0);
  const file = fs
    .readdirSync("backups")
    .filter((n) => n.endsWith(".enc"))
    .sort()
    .at(-1)!;
  const name = "finance_restore_test_" + Date.now();
  const restored = spawnSync(
    process.execPath,
    [
      "--env-file=.env",
      "scripts/backup.mjs",
      "--docker",
      "--restore",
      path.join("backups", file),
      name,
    ],
    { encoding: "utf8" },
  );
  expect(restored.status, restored.stderr).toBe(0);
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = "/" + name;
  const copy = new Client({ connectionString: u.toString() });
  try {
    await copy.connect();
    expect((await copy.query(query)).rows).toEqual(before);
  } finally {
    await copy.end();
    if (!/^finance_restore_test_\d+$/.test(name)) throw Error("Invalid target");
    await original.query(`DROP DATABASE "${name}"`);
    await original.end();
  }
}, 60000);
