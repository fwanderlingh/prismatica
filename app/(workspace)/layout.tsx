import type { ReactNode } from "react";
import { PrismaReviewAppClient } from "@/components/prisma-review-app-client";
import { MaintenanceMonitor } from "@/components/maintenance-monitor";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MaintenanceMonitor />
      <PrismaReviewAppClient />
      {children}
    </>
  );
}
