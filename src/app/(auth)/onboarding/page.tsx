import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "הקמת ארגון" };

export default function OnboardingPage() {
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-semibold">הקמת הארגון</h1>
      <p className="mb-6 text-sm text-muted">
        כל הנתונים, הצוות וההגדרות שייכים לארגון. אפשר להזמין חברי צוות אחר כך.
      </p>
      <OnboardingForm />
    </Card>
  );
}
