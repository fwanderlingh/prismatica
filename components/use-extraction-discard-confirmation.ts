import { useEffect, useLayoutEffect, useRef } from "react";

const discardMessage = "You have unsaved extraction answers. Discard these answers and continue?";

type HistoryNavigationEvent = Event & {
  navigationType: string;
  canIntercept: boolean;
  hashChange?: boolean;
};

export function useExtractionDiscardConfirmation(hasUnsavedAnswers: boolean, discardAnswers: () => void) {
  const guard = useRef({ hasUnsavedAnswers, discardAnswers });

  useLayoutEffect(() => {
    guard.current = { hasUnsavedAnswers, discardAnswers };
  }, [hasUnsavedAnswers, discardAnswers]);

  function confirmDiscard() {
    if (!guard.current.hasUnsavedAnswers) return true;
    if (!window.confirm(discardMessage)) return false;
    guard.current.hasUnsavedAnswers = false;
    guard.current.discardAnswers();
    return true;
  }

  useEffect(() => {
    if (!hasUnsavedAnswers) return;

    function beforeUnload(event: BeforeUnloadEvent) {
      if (!guard.current.hasUnsavedAnswers) return;
      event.preventDefault();
      event.returnValue = discardMessage;
    }

    // Supported browsers can cancel Back/Forward before the router changes pages.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    function beforeHistoryNavigation(event: Event) {
      const navigationEvent = event as HistoryNavigationEvent;
      if (navigationEvent.navigationType === "traverse" && !navigationEvent.hashChange && navigationEvent.canIntercept &&
        navigationEvent.cancelable && !confirmDiscard()) navigationEvent.preventDefault();
    }

    window.addEventListener("beforeunload", beforeUnload);
    navigation?.addEventListener("navigate", beforeHistoryNavigation);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      navigation?.removeEventListener("navigate", beforeHistoryNavigation);
    };
  }, [hasUnsavedAnswers]);

  return confirmDiscard;
}
