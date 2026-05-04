"use client";

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Copy, Check, Share2, X } from "lucide-react";

// ── Brand icons ───────────────────────────────────────────────────

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

// ── Row inside the share panel ────────────────────────────────────

function ShareOption({
  icon,
  label,
  sublabel,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-secondary transition-colors"
    >
      <span className="h-9 w-9 flex shrink-0 items-center justify-center rounded-xl bg-secondary">
        {icon}
      </span>
      <span className="flex flex-col leading-tight min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {sublabel && (
          <span className="text-xs text-muted-foreground">{sublabel}</span>
        )}
      </span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────

export function ShareButton({ name, url }: { name: string; url: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const hasNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const encodedUrl  = encodeURIComponent(url);
  const encodedText = encodeURIComponent(name);

  function openWindow(href: string) {
    window.open(href, "_blank", "noopener,noreferrer,width=640,height=520");
    setOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1800);
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: name, url });
    } catch {
      // user cancelled
    }
    setOpen(false);
  }

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {/* ── Share panel ── */}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 right-0 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">გაზიარება</span>
            <button
              onClick={() => setOpen(false)}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="დახურვა"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Options */}
          <div className="p-2 space-y-0.5">
            <ShareOption
              icon={<FacebookIcon className="h-4 w-4 text-[#1877F2]" />}
              label="Facebook"
              sublabel="გამოაქვეყნე ლენტაზე"
              onClick={() =>
                openWindow(
                  `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
                )
              }
            />
            <ShareOption
              icon={<WhatsAppIcon className="h-4 w-4 text-[#25D366]" />}
              label="WhatsApp"
              sublabel="გაუგზავნე მეგობარს"
              onClick={() =>
                openWindow(
                  `https://wa.me/?text=${encodeURIComponent(name + " — " + url)}`
                )
              }
            />
            <ShareOption
              icon={<TelegramIcon className="h-4 w-4 text-[#229ED9]" />}
              label="Telegram"
              sublabel="გაუგზავნე მეგობარს"
              onClick={() =>
                openWindow(
                  `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
                )
              }
            />

            {/* Native share — only shown on supporting devices (mobile) */}
            {hasNativeShare && (
              <ShareOption
                icon={<Share2 className="h-4 w-4 text-muted-foreground" />}
                label="სხვა..."
                sublabel="სხვა აპლიკაციები"
                onClick={nativeShare}
              />
            )}

            {/* Divider + copy */}
            <div className="pt-1 border-t border-border mt-1">
              <ShareOption
                icon={
                  copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )
                }
                label={copied ? "ბმული დაკოპირდა!" : "ბმულის კოპია"}
                sublabel={copied ? undefined : "Clipboard-ში შენახვა"}
                onClick={copyLink}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Trigger button ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="გაზიარება"
        className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-background text-sm font-medium hover:bg-secondary transition-colors w-full justify-center"
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        გაზიარება
      </button>
    </div>
  );
}
