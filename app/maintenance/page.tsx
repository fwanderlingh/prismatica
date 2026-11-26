import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MaintenancePage } from "@/components/maintenance-page";
import { getMaintenanceSettings } from "@/lib/serverMaintenance";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Under maintenance | PRISMATICA",
  robots: { index: false, follow: false }
};

export default async function Page() {
  const settings = await getMaintenanceSettings();
  if (!settings.enabled) redirect("/dashboard");
  return <MaintenancePage endsAt={settings.endsAt} />;
}
