import { Suspense } from "react";
import { GlobalSearch } from "@/components/global-search";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui";
import { MobileBar, SidebarAccount, SidebarNav } from "./sidebar";

export const instant = false;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-line bg-surface md:flex">
        <div className="flex h-14 items-center px-5">
          <Logo />
        </div>
        <Suspense fallback={<NavSkeleton />}>
          <SidebarNav />
        </Suspense>
        <div className="mt-auto border-t border-line p-3">
          <Suspense fallback={<Skeleton className="h-10" />}>
            <SidebarAccount />
          </Suspense>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <Suspense fallback={<MobileBarSkeleton />}>
          <MobileBar />
        </Suspense>
        <div className="sticky top-0 z-10 hidden h-14 items-center border-b border-line bg-bg/85 px-8 backdrop-blur md:flex">
          <GlobalSearch className="w-full max-w-sm" />
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}

function NavSkeleton() {
  return (
    <div className="grid gap-2 px-3 py-2">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}

function MobileBarSkeleton() {
  return <div className="h-14 border-b border-line bg-surface md:hidden" />;
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
