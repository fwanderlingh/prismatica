"use client";

import { useEffect, useRef } from "react";

export type SavedQueueDecision = {
  queueKey: string;
  itemId: string;
};

// A saved decision is a new object each time, even when voting on the same item.
// Consume it after React renders the updated queue, so failures, manual selections,
// and background refreshes do not move the reader.
export function useReviewQueueScroll(queueKey: string, itemId: string, savedDecision: SavedQueueDecision | null) {
  const handledDecision = useRef(savedDecision);

  useEffect(() => {
    if (handledDecision.current === savedDecision) return;
    handledDecision.current = savedDecision;
    if (!savedDecision || savedDecision.queueKey !== queueKey || savedDecision.itemId === itemId) return;
    if (!window.matchMedia("(max-width: 860px)").matches) return;

    window.scrollTo({
      top: 0,
      left: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
    });
  }, [queueKey, itemId, savedDecision]);
}
