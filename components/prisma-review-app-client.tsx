"use client";

import dynamic from "next/dynamic";

const PrismaReviewApp = dynamic(() => import("@/components/prisma-review-app").then((module) => module.PrismaReviewApp), {
  ssr: false
});

export function PrismaReviewAppClient() {
  return <PrismaReviewApp />;
}
