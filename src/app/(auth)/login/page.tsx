import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { DemoLogin, LoginForm } from "./login-form";

export const metadata: Metadata = { title: "התחברות" };

export default function LoginPage() {
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-semibold">התחברות</h1>
      <p className="mb-6 text-sm text-muted">ברוכים השבים. הזינו את פרטי החשבון.</p>
      {process.env.NEXT_PUBLIC_DEMO_MODE === "1" && (
        <div className="mb-6">
          <DemoLogin />
        </div>
      )}
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted">
        אין לכם חשבון?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          פתיחת חשבון
        </Link>
      </p>
    </Card>
  );
}
