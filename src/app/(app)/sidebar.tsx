import { Building2, CalendarClock, Handshake, LayoutGrid, MessageSquareText, Settings, Users, Webhook } from "lucide-react";
import { GlobalSearch } from "@/components/global-search";
import { Logo } from "@/components/logo";
import { Avatar } from "@/components/ui";
import { roleLabels } from "@/lib/permissions";
import { getCtx } from "@/lib/session";
import { NavLink, SignOutButton } from "./nav-client";

async function navItems() {
  const ctx = await getCtx();
  const icon = { size: 20, strokeWidth: 1.6 };
  return [
    { href: "/", label: "סקירה", icon: <LayoutGrid {...icon} />, show: true, group: "main" },
    { href: "/tickets", label: "פניות", icon: <MessageSquareText {...icon} />, show: ctx.can({ ticket: ["read"] }), group: "main" },
    { href: "/appointments", label: "תורים", icon: <CalendarClock {...icon} />, show: ctx.can({ appointment: ["read"] }), group: "main" },
    { href: "/deals", label: "עסקאות", icon: <Handshake {...icon} />, show: ctx.can({ deal: ["read"] }), group: "main" },
    { href: "/contacts", label: "אנשי קשר", icon: <Users {...icon} />, show: ctx.can({ contact: ["read"] }), group: "main" },
    { href: "/companies", label: "חברות", icon: <Building2 {...icon} />, show: ctx.can({ company: ["read"] }), group: "main" },
    { href: "/settings/team", label: "צוות והרשאות", icon: <Settings {...icon} />, show: ctx.can({ member: ["create"] }), group: "settings" },
    { href: "/settings/developers", label: "API ו-Webhooks", icon: <Webhook {...icon} />, show: ctx.can({ settings: ["update"] }), group: "settings" },
  ].filter((i) => i.show);
}

export async function SidebarNav() {
  const items = await navItems();
  return (
    <nav aria-label="ניווט ראשי" className="py-3">
      <ul className="grid">
        {items
          .filter((i) => i.group === "main")
          .map((i) => (
            <li key={i.href}>
              <NavLink href={i.href} icon={i.icon}>
                {i.label}
              </NavLink>
            </li>
          ))}
      </ul>
      {items.some((i) => i.group === "settings") && (
        <ul className="mt-3 grid border-t border-line pt-3">
          {items
            .filter((i) => i.group === "settings")
            .map((i) => (
              <li key={i.href}>
                <NavLink href={i.href} icon={i.icon}>
                  {i.label}
                </NavLink>
              </li>
            ))}
        </ul>
      )}
    </nav>
  );
}

/** Profile block under the logo, as in the kit: avatar, name, email, org and role. */
export async function SidebarAccount() {
  const ctx = await getCtx();
  return (
    <div className="flex items-center gap-3 px-6 py-6">
      <Avatar name={ctx.userName} size={46} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[15px] font-medium text-ink">{ctx.userName}</div>
        <div className="mt-1 truncate text-[11px] text-muted">
          <span className="ltr">{ctx.userEmail}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {ctx.orgName} · {roleLabels[ctx.role] ?? ctx.role}
        </div>
      </div>
    </div>
  );
}

export async function MobileBar() {
  const items = await navItems();
  return (
    <header className="sticky top-0 z-10 bg-surface shadow-card md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <SignOutButton />
      </div>
      <div className="px-4 pb-2">
        <GlobalSearch />
      </div>
      <nav aria-label="ניווט ראשי" className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2">
        {items.map((i) => (
          <NavLink key={i.href} href={i.href} icon={i.icon} compact>
            {i.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
