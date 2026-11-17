import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "../src/server/db";
export function createAuth() {
  return betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    rateLimit: { enabled: false },
  });
}
