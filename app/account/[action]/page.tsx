import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountEmailForm, type AccountEmailAction } from "@/components/account-email-form";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function AccountEmailPage({ params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!["forgot-password", "resend-confirmation", "verify-email", "reset-password"].includes(action)) notFound();
  return <AccountEmailForm key={action} action={action as AccountEmailAction} />;
}
