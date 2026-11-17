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
        "flex items-center gap-2.5 rounded-lg text-sm transition-colors",
        compact ? "h-8 shrink-0 px-2.5" : "h-9 px-3",
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icon}
      {children}
    </Link>
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
