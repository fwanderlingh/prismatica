import type { ReactNode } from "react";
import { PrismaReviewAppClient } from "@/components/prisma-review-app-client";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PrismaReviewAppClient />
      {children}
    </>
  );
}
