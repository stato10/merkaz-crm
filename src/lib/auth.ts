import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  session: { expiresIn: 60 * 60 * 24 * 14 },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
    }),
    nextCookies(),
  ],
  databaseHooks: {
    session: {
      create: {
        // Land the user in their first organization automatically.
        before: async (s) => {
          const first = await db.query.member.findFirst({
            where: eq(schema.member.userId, s.userId),
          });
          return { data: { ...s, activeOrganizationId: first?.organizationId ?? null } };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
