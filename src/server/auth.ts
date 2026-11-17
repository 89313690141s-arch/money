import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  appName: "Личные финансы",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  session: { expiresIn: 60 * 60 * 24 * 7, freshAge: 600 },
  rateLimit: { enabled: true, window: 60, max: 30 },
  advanced: {
    useSecureCookies:
      process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
  },
});
