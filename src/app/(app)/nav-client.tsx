"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function NavLink({
  href,
  icon,
  children,
  compact,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group flex items-center text-sm transition-colors",
        compact ? "h-8 shrink-0 gap-2 rounded px-2.5" : "h-10 gap-4 border-s-[3px] px-6 font-medium",
        active
          ? compact
            ? "bg-accent-soft text-accent"
            : "border-brand text-accent"
          : "border-transparent text-ink-2 hover:text-accent",
      )}
    >
      <span className={cx("transition-colors", active ? "text-brand" : "text-icon group-hover:text-brand")}>
        {icon}
      </span>
      {children}
    </Link>
  );
}

/** Sign-out row at the sidebar's foot, where the kit keeps "Toggle sidebar". */
export function SignOutRow() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="flex h-12 w-full items-center gap-3 px-6 text-xs text-muted transition-colors hover:text-ink"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut size={16} className="-scale-x-100 text-icon" aria-hidden />
      התנתקות
    </button>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      title="התנתקות"
      aria-label="התנתקות"
      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut size={16} className="-scale-x-100" />
    </button>
  );
}
