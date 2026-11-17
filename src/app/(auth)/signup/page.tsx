import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "פתיחת חשבון" };

export default function SignupPage() {
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-semibold">פתיחת חשבון</h1>
      <p className="mb-6 text-sm text-muted">כמה פרטים, ואתם בפנים.</p>
      <Suspense>
        <SignupForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted">
        כבר יש לכם חשבון?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          התחברות
        </Link>
      </p>
    </Card>
  );
}
