import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

const rubik = Rubik({ variable: "--font-rubik", subsets: ["hebrew", "latin"] });

export const metadata: Metadata = {
  title: { default: "מרכז", template: "%s · מרכז" },
  description: "CRM למכירות ושירות",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
