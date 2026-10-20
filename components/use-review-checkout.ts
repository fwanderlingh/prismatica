"use client";

import { useEffect, useRef } from "react";
import type { AppMutationPayload } from "@/lib/apiTypes";
import { getCheckoutRefreshIntervalMs } from "@/lib/workflowSelectors";

export type ReviewCheckoutTarget = {
  projectId: string;
  studyId: string;
  reportId?: string;
  templateId?: string;
  stage: "title_abstract" | "full_text" | "extraction";
};

export type ReviewCheckoutRequest = ReviewCheckoutTarget & {
  checkoutId: string;
  action: "acquire" | "release";
};

type ReviewCheckoutOptions = {
  userId: string | null;
  target: ReviewCheckoutTarget | null;
  checkoutWindowMinutes: number;
  acquire: (request: ReviewCheckoutRequest) => Promise<AppMutationPayload>;
  onAcquired: (payload: AppMutationPayload) => void;
  onStart?: () => void;
  onError?: (error: unknown) => void;
};

export function useReviewCheckout({
  userId, target, checkoutWindowMinutes, acquire, onAcquired, onStart, onError
}: ReviewCheckoutOptions) {
  const callbacks = useRef({ acquire, onAcquired, onStart, onError });
  useEffect(() => {
    callbacks.current = { acquire, onAcquired, onStart, onError };
  });

  const projectId = target?.projectId;
  const studyId = target?.studyId;
  const reportId = target?.reportId;
  const templateId = target?.templateId;
  const stage = target?.stage;

  useEffect(() => {
    if (!userId || !projectId || !studyId || !stage) return;
    if (stage !== "title_abstract" && !reportId) return;
    if (stage === "extraction" && !templateId) return;

    let isCancelled = false;
    let isPending = false;
    const requestBody = {
      projectId,
      studyId,
      stage,
      ...(reportId ? { reportId } : {}),
      ...(templateId ? { templateId } : {}),
      checkoutId: `${stage}-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    };
    callbacks.current.onStart?.();

    async function acquireCheckout() {
      if (isCancelled || isPending) return;
      isPending = true;
      try {
        const payload = await callbacks.current.acquire({ ...requestBody, action: "acquire" });
        if (!isCancelled) callbacks.current.onAcquired(payload);
      } catch (error) {
        if (!isCancelled) callbacks.current.onError?.(error);
      } finally {
        isPending = false;
      }
    }

    void acquireCheckout();
    const intervalId = window.setInterval(acquireCheckout, getCheckoutRefreshIntervalMs(checkoutWindowMinutes));

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      // Keep the session token: a late cleanup must not release a newer checkout.
      void fetch("/api/screening-checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody, action: "release" }),
        keepalive: true
      }).catch(() => undefined);
    };
  }, [userId, projectId, studyId, reportId, templateId, stage, checkoutWindowMinutes]);
}
