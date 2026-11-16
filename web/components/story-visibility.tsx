"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { FeedEntry } from "@/lib/feed-pagination";

const VIEWABILITY_RATIO = 0.5;
const VIEWABILITY_DURATION_MS = 1000;

// An impression means at least half the card was visible continuously for a
// second while the tab was active. Loading a page alone is not an impression.
export function StoryVisibility({
  entry,
  onImpression,
  children,
}: {
  entry: FeedEntry;
  onImpression: (entry: FeedEntry) => void;
  children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = elementRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    const clear = () => {
      visible = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const observer = new IntersectionObserver(
      ([observation]) => {
        if (!observation) return;
        if (
          observation.isIntersecting &&
          observation.intersectionRatio >= VIEWABILITY_RATIO &&
          document.visibilityState === "visible"
        ) {
          if (!visible) {
            visible = true;
            timer = setTimeout(() => {
              if (visible && document.visibilityState === "visible") {
                onImpression(entry);
              }
            }, VIEWABILITY_DURATION_MS);
          }
        } else {
          clear();
        }
      },
      { threshold: [0, VIEWABILITY_RATIO, 1] },
    );
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") clear();
      else {
        // Recompute on tab return rather than crediting background time.
        observer.unobserve(node);
        observer.observe(node);
      }
    };
    observer.observe(node);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clear();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [entry, onImpression]);

  return <div ref={elementRef} data-testid="visible-story">{children}</div>;
}
