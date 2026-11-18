import { Building2, CalendarClock, Gauge, Inbox, Settings, Users } from "lucide-react";
import { GlobalSearch } from "@/components/global-search";
import { Logo } from "@/components/logo";
import { Avatar } from "@/components/ui";
import { roleLabels } from "@/lib/permissions";
import { getCtx } from "@/lib/session";
import { NavLink, SignOutButton } from "./nav-client";

async function navItems() {
  const ctx = await getCtx();
  return [
    { href: "/", label: "סקירה", icon: <Gauge size={17} />, show: true },
    { href: "/tickets", label: "פניות", icon: <Inbox size={17} />, show: ctx.can({ ticket: ["read"] }) },
    { href: "/appointments", label: "תורים", icon: <CalendarClock size={17} />, show: ctx.can({ appointment: ["read"] }) },
    { href: "/contacts", label: "אנשי קשר", icon: <Users size={17} />, show: ctx.can({ contact: ["read"] }) },
    { href: "/companies", label: "חברות", icon: <Building2 size={17} />, show: ctx.can({ company: ["read"] }) },
    { href: "/settings/team", label: "צוות והרשאות", icon: <Settings size={17} />, show: ctx.can({ member: ["create"] }) },
  ].filter((i) => i.show);
}

export async function SidebarNav() {
  const items = await navItems();
  return (
    <nav aria-label="ניווט ראשי" className="grid gap-0.5 px-3 py-2">
      {items.map((i) => (
        <NavLink key={i.href} href={i.href} icon={i.icon}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

export async function SidebarAccount() {
  const ctx = await getCtx();
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={ctx.userName} size={34} />
      <div className="min-w-0 flex-1 text-sm leading-tight">
        <div className="truncate font-medium">{ctx.userName}</div>
        <div className="truncate text-xs text-muted">
          {ctx.orgName} · {roleLabels[ctx.role] ?? ctx.role}
        </div>
      </div>
      <SignOutButton />
    </div>
  );
}

export async function MobileBar() {
  const items = await navItems();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface md:hidden">
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
