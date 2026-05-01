"use client";
import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "wishm_install_dismissed_at";
const REMIND_AFTER_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelper, setShowIosHelper] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    // Check if user dismissed recently
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const at = Number(raw);
        if (Number.isFinite(at) && Date.now() - at < REMIND_AFTER_MS) return;
      }
    } catch {
      // localStorage unavailable
    }

    // Android / Chrome / Edge — listen for the install event
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // iOS — no native install event, show manual instructions after delay
    if (isIOS()) {
      const timer = setTimeout(() => setShowIosHelper(true), 4000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setInstallEvent(null);
    setShowIosHelper(false);
  }

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  // Android/Chrome native install prompt
  if (installEvent) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 rounded-2xl border bg-card shadow-2xl p-4 animate-in slide-in-from-bottom-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">დააინსტალე WishMotors</p>
            <p className="text-xs text-foreground/60 mt-0.5">
              დაამატე მთავარ ეკრანზე — სწრაფი წვდომა, ბრაუზერის გარეშე
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="flex-1 text-sm font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                დამატება
              </button>
              <button
                onClick={dismiss}
                className="text-sm px-3 py-2 rounded-lg border hover:bg-secondary transition-colors"
              >
                მოგვიანებით
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // iOS — manual instructions
  if (showIosHelper) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 rounded-2xl border bg-card shadow-2xl p-4 animate-in slide-in-from-bottom-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">დაამატე მთავარ ეკრანზე</p>
            <p className="text-xs text-foreground/60 mt-1 leading-relaxed">
              დააჭირე <span className="inline-flex items-center mx-0.5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 inline fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </span>
              ღილაკს და აირჩიე <strong>&quot;Add to Home Screen&quot;</strong>
            </p>
            <button
              onClick={dismiss}
              className="mt-3 text-sm px-3 py-2 rounded-lg border hover:bg-secondary transition-colors"
            >
              გასაგებია
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
