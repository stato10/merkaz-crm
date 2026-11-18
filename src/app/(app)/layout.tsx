import { Suspense } from "react";
import { Bell } from "lucide-react";
import { GlobalSearch } from "@/components/global-search";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui";
import { SignOutRow } from "./nav-client";
import { MobileBar, SidebarAccount, SidebarNav } from "./sidebar";

export const instant = false;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 z-20 hidden h-dvh w-64 shrink-0 flex-col bg-surface shadow-[-6px_0_18px_rgb(0_0_0/0.06)] md:flex">
        <div className="flex h-15 shrink-0 items-center border-b border-line px-6">
          <Logo />
        </div>
        <Suspense fallback={<div className="px-6 py-6"><Skeleton className="h-12" /></div>}>
          <SidebarAccount />
        </Suspense>
        <Suspense fallback={<NavSkeleton />}>
          <SidebarNav />
        </Suspense>
        <div className="mt-auto">
          <SignOutRow />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <Suspense fallback={<MobileBarSkeleton />}>
          <MobileBar />
        </Suspense>
        <div className="sticky top-0 z-10 hidden h-15 items-center gap-4 border-b border-line bg-surface px-8 md:flex">
          <GlobalSearch className="w-full max-w-md" bare />
          <span className="ms-auto grid size-9 place-items-center text-icon" aria-hidden>
            <Bell size={20} strokeWidth={1.6} />
          </span>
        </div>
        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 md:px-9 md:py-9">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}

function NavSkeleton() {
  return (
    <div className="grid gap-2 px-6 py-3">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}

function MobileBarSkeleton() {
  return <div className="h-14 bg-surface shadow-card md:hidden" />;
}

function PageSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="mt-4 h-64" />
    </div>
  );
}
