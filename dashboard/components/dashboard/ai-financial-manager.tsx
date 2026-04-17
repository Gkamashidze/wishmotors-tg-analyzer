"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  RefreshCw,
  AlertTriangle,
  TrendingDown,
  Package,
  Wallet,
  Clock,
  Sparkles,
} from "lucide-react";
import type { AiInsightsResponse, AiMetrics } from "@/app/api/ai-insights/route";
import { formatGEL } from "@/lib/utils";

// ─── Advice renderer ──────────────────────────────────────────────────────────

function sanitize(html: string): string {
  return html.replace(/<(?!\/?(?:b|i)\b)[^>]*>/gi, "");
}

function AdviceLine({ raw }: { raw: string }) {
  const clean = sanitize(raw);
  return (
    <li className="flex items-start gap-2 leading-snug">
      <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
      <span
        className="text-sm text-foreground/90"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </li>
  );
}

function parseAdvice(text: string): { header: string; bullets: string[] } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const header = lines.find((l) => l.includes("ფინანსური მენეჯერი")) ?? lines[0] ?? "";
  const bullets = lines.filter((l) => l.startsWith("•")).map((l) => l.replace(/^•\s*/, ""));
  return { header, bullets };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[80, 92, 70, 85].map((w, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
          <div
            className="h-4 rounded-md bg-muted"
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Metric chips ─────────────────────────────────────────────────────────────

type ChipProps = {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: "default" | "warning" | "destructive" | "success";
};

const toneClasses: Record<ChipProps["tone"], string> = {
  default: "bg-primary/10 text-primary border-primary/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  success: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
};

function MetricChip({ icon: Icon, label, value, tone }: ChipProps) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${toneClasses[tone]}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: AiMetrics }) {
  const marginTone =
    metrics.grossMarginPct >= 40
      ? "success"
      : metrics.grossMarginPct >= 20
        ? "default"
        : "destructive";

  const ordersTone = metrics.urgentOrders > 3 ? "destructive" : metrics.urgentOrders > 0 ? "warning" : "default";

  const arTone = metrics.accountsReceivable > metrics.cashOnHand ? "warning" : "default";

  return (
    <div className="flex flex-wrap gap-2 pt-4 border-t border-border/60">
      <MetricChip
        icon={TrendingDown}
        label="მარჟა"
        value={`${metrics.grossMarginPct.toFixed(1)}%`}
        tone={marginTone}
      />
      {metrics.urgentOrders > 0 && (
        <MetricChip
          icon={AlertTriangle}
          label="სასწრაფო"
          value={String(metrics.urgentOrders)}
          tone={ordersTone}
        />
      )}
      {metrics.restockAlerts > 0 && (
        <MetricChip
          icon={Package}
          label="მარაგი"
          value={String(metrics.restockAlerts)}
          tone="warning"
        />
      )}
      {metrics.driftAlerts > 0 && (
        <MetricChip
          icon={TrendingDown}
          label="WAC drift"
          value={String(metrics.driftAlerts)}
          tone="warning"
        />
      )}
      <MetricChip
        icon={Wallet}
        label="ნისია"
        value={formatGEL(metrics.accountsReceivable)}
        tone={arTone}
      />
      <MetricChip
        icon={Clock}
        label="პერიოდი"
        value={`${metrics.periodDays}დ`}
        tone="default"
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AiFinancialManager() {
  const [data, setData] = useState<AiInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchInsights = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSpinning(true);
    setLoading(true);

    try {
      const res = await fetch("/api/ai-insights", {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AiInsightsResponse = await res.json();
      setData(json);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[AiFinancialManager] fetch error:", err);
      }
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
    return () => abortRef.current?.abort();
  }, [fetchInsights]);

  const parsed = data?.advice ? parseAdvice(data.advice) : null;

  const updatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString("ka-GE", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* ── Gradient header ── */}
      <div className="relative flex items-center justify-between gap-4 px-5 py-4 bg-gradient-to-r from-blue-600/10 via-violet-600/10 to-indigo-600/5 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 shadow-sm">
            <Brain className="h-4 w-4 text-white" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight leading-none">
              AI ფინანსური მენეჯერი
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Claude Haiku&nbsp;·&nbsp;ბოლო 7 დღე
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {updatedAt && !loading && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))] shadow-[0_0_4px_hsl(var(--success))]" />
              {updatedAt}
            </span>
          )}
          <button
            onClick={fetchInsights}
            disabled={loading}
            aria-label="AI რჩევების განახლება"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-5 py-4 space-y-4">
        {loading ? (
          <Skeleton />
        ) : data?.error === "api_key_missing" ? (
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-warning">ANTHROPIC_API_KEY არ არის დაყენებული</p>
              <p className="text-xs text-muted-foreground">
                ფინანსური მეტრიკა მაინც ჩანს — AI ანალიზისთვის დაამატე გასაღები Railway-ში.
              </p>
            </div>
          </div>
        ) : data?.error ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">
              {data.error === "db_error"
                ? "ბაზასთან კავშირი ვერ მოხერხდა"
                : "AI ანალიზის შეცდომა — სცადე განახლება"}
            </p>
          </div>
        ) : parsed ? (
          <ul className="space-y-3" role="list" aria-label="AI ბიზნეს-რჩევები">
            {parsed.bullets.map((bullet, i) => (
              <AdviceLine key={i} raw={bullet} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 opacity-30" aria-hidden="true" />
            <p className="text-sm">ანალიზის მონაცემები ჯერ არ არის — განახლება სცადე</p>
          </div>
        )}

        {/* ── Metrics row (always shows when data is available) ── */}
        {data && !loading && data.error !== "db_error" && (
          <MetricsRow metrics={data.metrics} />
        )}
      </div>
    </div>
  );
}
