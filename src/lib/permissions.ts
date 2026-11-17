import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Every permission in the CRM. Resources map to the actions allowed on them.
 * Server code must call `requirePermission()` before reading or writing.
 */
export const statement = {
  ...defaultStatements,
  contact: ["create", "read", "update", "delete"],
  company: ["create", "read", "update", "delete"],
  deal: ["create", "read", "update", "delete"],
  ticket: ["create", "read", "update", "delete"],
  report: ["read"],
  settings: ["read", "update"],
  audit: ["read"],
} as const;

export const ac = createAccessControl(statement);

const crud = ["create", "read", "update", "delete"] as const;

export const owner = ac.newRole({
  ...ownerAc.statements,
  contact: [...crud],
  company: [...crud],
  deal: [...crud],
  ticket: [...crud],
  report: ["read"],
  settings: ["read", "update"],
  audit: ["read"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  contact: [...crud],
  company: [...crud],
  deal: [...crud],
  ticket: [...crud],
  report: ["read"],
  settings: ["read", "update"],
  audit: ["read"],
});

/** Sales rep: owns the pipeline, can see tickets but not handle them. */
export const sales = ac.newRole({
  ...memberAc.statements,
  contact: ["create", "read", "update"],
  company: ["create", "read", "update"],
  deal: ["create", "read", "update"],
  ticket: ["read"],
  report: ["read"],
});

/** Service agent: handles tickets, can see sales data read-only. */
export const agent = ac.newRole({
  ...memberAc.statements,
  contact: ["create", "read", "update"],
  company: ["read"],
  deal: ["read"],
  ticket: ["create", "read", "update"],
});

export const roles = { owner, admin, sales, agent };
export type RoleName = keyof typeof roles;

export const roleLabels: Record<RoleName, string> = {
  owner: "בעלים",
  admin: "מנהל",
  sales: "איש מכירות",
  agent: "נציג שירות",
};

export type Permissions = {
  [K in keyof typeof statement]?: (typeof statement)[K][number][];
};

export function roleCan(role: string, permissions: Permissions): boolean {
  const r = roles[role as RoleName];
  if (!r) return false;
  return r.authorize(permissions).success;
}
