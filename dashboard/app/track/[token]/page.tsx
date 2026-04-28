import { notFound } from "next/navigation";
import { getPersonalOrderByToken, type PersonalOrderStatus } from "@/lib/personal-orders-queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

const STATUS_STEPS: PersonalOrderStatus[] = ["ordered", "in_transit", "arrived", "delivered"];

const STATUS_LABELS: Record<PersonalOrderStatus, string> = {
  ordered:    "შეკვეთილია",
  in_transit: "გზაშია",
  arrived:    "ჩამოვიდა",
  delivered:  "გადაეცა",
  cancelled:  "გაუქმდა",
};

const STATUS_ICONS: Record<PersonalOrderStatus, string> = {
  ordered:    "📦",
  in_transit: "🚚",
  arrived:    "✅",
  delivered:  "🎉",
  cancelled:  "❌",
};

function fmtGel(v: number) {
  return `₾${Number(v).toFixed(2)}`;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return null;
  try {
    return new Date(v).toLocaleDateString("ka-GE", {
      day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return v; }
}

export default async function TrackingPage({ params }: Props) {
  const { token } = await params;

  if (!token || !/^[0-9a-f]{32}$/i.test(token)) {
    notFound();
  }

  const order = await getPersonalOrderByToken(token);
  if (!order) notFound();

  const sale = Number(order.sale_price);
  const paid = Number(order.amount_paid);
  const remaining = sale - paid;
  const paidPct = sale > 0 ? Math.min(100, (paid / sale) * 100) : 0;

  const isCancelled = order.status === "cancelled";
  const currentStepIdx = isCancelled ? -1 : STATUS_STEPS.indexOf(order.status);
  const arrival = fmtDate(order.estimated_arrival);

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-5 text-white">
          <p className="text-xs opacity-70 mb-1">შეკვეთა #{order.id}</p>
          <h1 className="text-xl font-bold leading-tight">{order.part_name}</h1>
          {order.oem_code && (
            <p className="text-xs opacity-60 mt-1 font-mono">{order.oem_code}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-2xl">{STATUS_ICONS[order.status]}</span>
            <span className="text-base font-semibold">{STATUS_LABELS[order.status]}</span>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Progress steps */}
          {!isCancelled && (
            <div className="flex items-center gap-0">
              {STATUS_STEPS.map((step, idx) => {
                const done = idx <= currentStepIdx;
                const active = idx === currentStepIdx;
                return (
                  <div key={step} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                        done ? "bg-slate-800 text-white" : "bg-gray-200 text-gray-400"
                      } ${active ? "ring-2 ring-offset-2 ring-slate-600" : ""}`}>
                        {done ? "✓" : idx + 1}
                      </div>
                      <span className={`text-xs mt-1 text-center leading-tight w-16 ${
                        done ? "text-slate-800 font-medium" : "text-gray-400"
                      }`}>
                        {STATUS_LABELS[step]}
                      </span>
                    </div>
                    {idx < STATUS_STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 mb-5 mx-1 ${idx < currentStepIdx ? "bg-slate-800" : "bg-gray-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Arrival */}
          {arrival && (
            <div className="flex items-center gap-3 bg-blue-50 rounded-xl px-4 py-3">
              <span className="text-2xl">📅</span>
              <div>
                <p className="text-xs text-blue-600 font-medium">სავარაუდო ჩამოსვლა</p>
                <p className="text-base font-bold text-blue-800">{arrival}</p>
              </div>
            </div>
          )}

          {/* Payment summary */}
          <div className="border rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">გადახდა</h2>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">სრული თანხა</span>
              <span className="font-bold">{fmtGel(sale)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">გადახდილია</span>
              <span className="font-semibold text-green-600">{fmtGel(paid)}</span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${paidPct}%` }}
              />
            </div>

            {remaining > 0 ? (
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-gray-700">დარჩენილია</span>
                <span className="text-amber-600">{fmtGel(remaining)}</span>
              </div>
            ) : (
              <div className="text-center text-green-600 font-semibold text-sm">
                ✅ სრულად გადახდილია
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-xs text-center text-gray-400 pt-2">
            wishmotors • ავტო ნაწილები
          </p>
        </div>
      </div>
    </div>
  );
}
