"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const KEY = "testimony-feed:welcome-dismissed";
const CHANGED = "testimony-feed:welcome-changed";
let dismissedInMemory = false;

// Only a non-sensitive dismissal marker is stored. Descriptions, demographics,
// preference vectors and free text never enter browser storage here.
function isWelcomeVisible() {
  if (dismissedInMemory) return false;
  try {
    return window.localStorage.getItem(KEY) !== "true";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGED, listener);
  };
}

export function dismissWelcome() {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(KEY, "true");
  } catch {
    // Browsing without storage must still be possible.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function WelcomePrompt() {
  const visible = useSyncExternalStore(
    subscribe,
    isWelcomeVisible,
    () => false,
  );
  if (!visible) return null;

  return (
    <aside
      className="welcome-prompt"
      data-testid="welcome-prompt"
      aria-label="歡迎探索見證故事"
    >
      <p className="welcome-prompt-kicker">一段故事，一點同行</p>
      <h2>找到與你此刻心情相近的見證</h2>
      <p>
        你可以簡單分享近況，讓故事更貼近你的生活；也可以什麼都不填，直接開始閱讀。
      </p>
      <div className="welcome-actions">
        <Link
          className="ui-button ui-button--primary"
          href="/personalize"
          onClick={dismissWelcome}
        >
          讓故事更貼近我
        </Link>
        <button
          type="button"
          className="ui-button ui-button--quiet"
          onClick={dismissWelcome}
        >
          略過，直接探索
        </button>
      </div>
    </aside>
  );
}
