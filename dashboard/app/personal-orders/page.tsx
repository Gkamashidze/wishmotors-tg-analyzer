"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/top-bar";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PersonalOrderRow, PersonalOrderStatus } from "@/lib/personal-orders-queries";

const STATUS_LABELS: Record<PersonalOrderStatus, string> = {
  ordered:    "📦 შეკვეთილია",
  in_transit: "🚚 გზაშია",
  arrived:    "✅ ჩამოვიდა",
  delivered:  "🎉 გადაეცა",
  cancelled:  "❌ გაუქმდა",
};

const STATUS_VARIANTS: Record<PersonalOrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ordered:    "secondary",
  in_transit: "default",
  arrived:    "default",
  delivered:  "default",
  cancelled:  "destructive",
};

function fmtGel(v: number | null | undefined) {
  return v != null ? `₾${Number(v).toFixed(2)}` : "—";
}

function fmtPrice(v: number | null | undefined, currency: string) {
  if (v == null) return "—";
  return currency === "USD" ? `$${Number(v).toFixed(2)}` : `₾${Number(v).toFixed(2)}`;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("ka-GE", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return v; }
}

function fmtPriceRange(min: number | null | undefined, max: number, currency: string) {
  if (min != null && Number(min) > 0) {
    return `${fmtPrice(Number(min), currency)} – ${fmtPrice(Number(max), currency)}`;
  }
  return fmtPrice(Number(max), currency);
}

function calcProfit(order: PersonalOrderRow) {
  return Number(order.sale_price)
    - Number(order.cost_price ?? 0)
    - Number(order.transportation_cost ?? 0)
    - Number(order.vat_amount ?? 0);
}

// ─── Copy tracking link ───────────────────────────────────────────────────────

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/track/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      window.prompt("კოპირება:", url);
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} title="ლინკის კოპირება">
      {copied ? "✅" : "🔗"}
    </Button>
  );
}

// ─── Items editor ─────────────────────────────────────────────────────────────

interface ItemInput { part_name: string; oem_code: string; }

function ItemsEditor({
  items,
  onChange,
}: {
  items: ItemInput[];
  onChange: (items: ItemInput[]) => void;
}) {
  function setItem(idx: number, field: keyof ItemInput, val: string) {
    onChange(items.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }
  function addItem() {
    onChange([...items, { part_name: "", oem_code: "" }]);
  }
  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-end">
          <div className="flex-1">
            {idx === 0 && <label className="text-xs text-muted-foreground">ნაწილი *</label>}
            <Input
              required={idx === 0}
              value={item.part_name}
              onChange={e => setItem(idx, "part_name", e.target.value)}
              placeholder="ნაწილის სახელი"
            />
          </div>
          <div className="w-32">
            {idx === 0 && <label className="text-xs text-muted-foreground">OEM კოდი</label>}
            <Input
              value={item.oem_code}
              onChange={e => setItem(idx, "oem_code", e.target.value)}
              placeholder="ABC123"
            />
          </div>
          {items.length > 1 && (
            <Button type="button" variant="ghost" size="sm" className="mb-0.5 text-red-500" onClick={() => removeItem(idx)}>✕</Button>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addItem}>+ ნაწილის დამატება</Button>
    </div>
  );
}

// ─── New Order Form ───────────────────────────────────────────────────────────

function NewOrderForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemInput[]>([{ part_name: "", oem_code: "" }]);
  const [saleCurrency, setSaleCurrency] = useState<"GEL" | "USD">("GEL");
  const [form, setForm] = useState({
    customer_name: "", customer_contact: "",
    cost_price: "", transportation_cost: "", vat_amount: "",
    sale_price_min: "", sale_price: "",
    estimated_arrival: "", notes: "",
  });

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function resetForm() {
    setItems([{ part_name: "", oem_code: "" }]);
    setSaleCurrency("GEL");
    setForm({
      customer_name: "", customer_contact: "",
      cost_price: "", transportation_cost: "", vat_amount: "",
      sale_price_min: "", sale_price: "",
      estimated_arrival: "", notes: "",
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter(i => i.part_name.trim());
    if (!validItems.length) {
      alert("სულ მცირე ერთი ნაწილი შეიყვანე.");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        customer_name: form.customer_name.trim(),
        sale_price: parseFloat(form.sale_price),
        items: validItems.map(i => ({
          part_name: i.part_name.trim(),
          oem_code: i.oem_code.trim().toUpperCase() || null,
        })),
      };
      if (form.customer_contact.trim()) body.customer_contact = form.customer_contact.trim();
      if (form.cost_price) body.cost_price = parseFloat(form.cost_price);
      if (form.transportation_cost) body.transportation_cost = parseFloat(form.transportation_cost);
      if (form.vat_amount) body.vat_amount = parseFloat(form.vat_amount);
      if (form.sale_price_min) body.sale_price_min = parseFloat(form.sale_price_min);
      body.sale_price_currency = saleCurrency;
      if (form.estimated_arrival) body.estimated_arrival = form.estimated_arrival;
      if (form.notes.trim()) body.notes = form.notes.trim();

      const res = await fetch("/api/personal-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("server error");
      setOpen(false);
      resetForm();
      onCreated();
    } catch {
      alert("შეცდომა შენახვისას. სცადე ხელახლა.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>+ ახალი შეკვეთა</Button>
      <Dialog open={open} onClose={() => { setOpen(false); resetForm(); }} title="ახალი კერძო შეკვეთა">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">მომხმარებელი *</label>
              <Input required value={form.customer_name} onChange={e => set("customer_name", e.target.value)} placeholder="სახელი გვარი" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">საკონტაქტო</label>
              <Input value={form.customer_contact} onChange={e => set("customer_contact", e.target.value)} placeholder="+995 / @username" />
            </div>
          </div>

          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">ნაწილები</p>
            <ItemsEditor items={items} onChange={setItems} />
          </div>

          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">ფინანსური (მხოლოდ შენ ხედავ)</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">ღირებულება ($)</label>
                <Input type="number" step="0.01" min="0" value={form.cost_price} onChange={e => set("cost_price", e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">ტრანსპ. (₾)</label>
                <Input type="number" step="0.01" min="0" value={form.transportation_cost} onChange={e => set("transportation_cost", e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">დღგ (₾)</label>
                <Input type="number" step="0.01" min="0" value={form.vat_amount} onChange={e => set("vat_amount", e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">გასაყიდი ფასი</label>
                <div className="flex rounded-md border overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setSaleCurrency("GEL")}
                    className={`px-2 py-0.5 transition-colors ${saleCurrency === "GEL" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >₾ ლარი</button>
                  <button
                    type="button"
                    onClick={() => setSaleCurrency("USD")}
                    className={`px-2 py-0.5 transition-colors ${saleCurrency === "USD" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >$ დოლარი</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">დან ({saleCurrency === "USD" ? "$" : "₾"})</label>
                  <Input type="number" step="0.01" min="0" value={form.sale_price_min} onChange={e => set("sale_price_min", e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">მდე ({saleCurrency === "USD" ? "$" : "₾"}) *</label>
                  <Input required type="number" step="0.01" min="0.01" value={form.sale_price} onChange={e => set("sale_price", e.target.value)} placeholder="0.00" />
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">ჩამოსვლის თარიღი</label>
            <Input type="date" value={form.estimated_arrival} onChange={e => set("estimated_arrival", e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">შენიშვნები</label>
            <Input value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="ნებისმიერი შენიშვნა..." />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "ინახება..." : "✅ შენახვა"}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setOpen(false); resetForm(); }}>გაუქმება</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

// ─── Delete Button ────────────────────────────────────────────────────────────

function DeleteOrderButton({ order, onDeleted }: { order: PersonalOrderRow; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(`შეკვეთა #${order.id} (${order.customer_name}) წაიშლება. დარწმუნებული ხარ?`)) return;
    setLoading(true);
    try {
      await fetch(`/api/personal-orders/${order.id}`, { method: "DELETE" });
      onDeleted();
    } catch {
      alert("შეცდომა. სცადე ხელახლა.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleDelete} disabled={loading} className="text-red-500 hover:text-red-700" title="წაშლა">
      {loading ? "..." : "🗑"}
    </Button>
  );
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

function EditOrderDialog({ order, onUpdated }: { order: PersonalOrderRow; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(order.status);
  const [amountPaid, setAmountPaid] = useState(String(order.amount_paid));
  const [arrival, setArrival] = useState(order.estimated_arrival ?? "");
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      await fetch(`/api/personal-orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          amount_paid: parseFloat(amountPaid) || 0,
          estimated_arrival: arrival || null,
        }),
      });
      setOpen(false);
      onUpdated();
    } catch {
      alert("შეცდომა. სცადე ხელახლა.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>✏️</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`შეკვეთა #${order.id} — რედაქტირება`}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">სტატუსი</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as PersonalOrderStatus)}
              className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {(Object.keys(STATUS_LABELS) as PersonalOrderStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">გადახდილი (₾)</label>
            <Input type="number" step="0.01" min="0" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">ჩამოსვლის თარიღი</label>
            <Input type="date" value={arrival} onChange={e => setArrival(e.target.value)} />
          </div>
          <Button onClick={save} disabled={loading} className="w-full">
            {loading ? "ინახება..." : "შენახვა"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PersonalOrdersPage() {
  const [orders, setOrders] = useState<PersonalOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/personal-orders");
      setOrders(await res.json() as PersonalOrderRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeCount = orders.filter(o => !["delivered", "cancelled"].includes(o.status)).length;
  const totalRevenue = orders.reduce((s, o) => s + Number(o.sale_price), 0);
  const totalProfit = orders.reduce((s, o) => s + calcProfit(o), 0);

  return (
    <>
      <TopBar title="კერძო შეკვეთები" />
      <main className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">სულ</p><p className="text-2xl font-bold">{orders.length}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">აქტიური</p><p className="text-2xl font-bold text-blue-600">{activeCount}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">შემოსავალი</p><p className="text-2xl font-bold">{fmtGel(totalRevenue)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">მოგება</p><p className={`text-2xl font-bold ${totalProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{fmtGel(totalProfit)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>შეკვეთები</CardTitle>
              <CardDescription>ყველა პირადი შეკვეთა</CardDescription>
            </div>
            <NewOrderForm onCreated={load} />
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">იტვირთება...</div>
            ) : orders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">შეკვეთები არ გაქვს</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-3">#</th>
                      <th className="text-left py-2 pr-3">მომხმ.</th>
                      <th className="text-left py-2 pr-3">ნაწილები</th>
                      <th className="text-left py-2 pr-3">სტატუსი</th>
                      <th className="text-right py-2 pr-3">ფასი</th>
                      <th className="text-right py-2 pr-3">გადახდ.</th>
                      <th className="text-right py-2 pr-3">დარჩა</th>
                      <th className="text-right py-2 pr-3">მოგება</th>
                      <th className="text-left py-2 pr-3">ჩამოსვლა</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => {
                      const remaining = Number(order.sale_price) - Number(order.amount_paid);
                      const profit = calcProfit(order);
                      const displayItems = order.items?.length ? order.items : [{ id: 0, part_name: order.part_name, oem_code: order.oem_code }];
                      return (
                        <tr key={order.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="py-2 pr-3 font-mono text-muted-foreground">#{order.id}</td>
                          <td className="py-2 pr-3 font-medium">{order.customer_name}</td>
                          <td className="py-2 pr-3">
                            {displayItems.map((item, idx) => (
                              <div key={idx}>
                                <div>{item.part_name}</div>
                                {item.oem_code && <div className="text-xs text-muted-foreground font-mono">{item.oem_code}</div>}
                              </div>
                            ))}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge variant={STATUS_VARIANTS[order.status]}>{STATUS_LABELS[order.status]}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{fmtPriceRange(order.sale_price_min, Number(order.sale_price), order.sale_price_currency ?? "GEL")}</td>
                          <td className="py-2 pr-3 text-right font-mono">{fmtGel(Number(order.amount_paid))}</td>
                          <td className={`py-2 pr-3 text-right font-mono font-semibold ${remaining > 0 ? "text-amber-600" : "text-green-600"}`}>{fmtGel(remaining)}</td>
                          <td className={`py-2 pr-3 text-right font-mono font-semibold ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>{fmtGel(profit)}</td>
                          <td className="py-2 pr-3 text-sm text-muted-foreground">{fmtDate(order.estimated_arrival)}</td>
                          <td className="py-2">
                            <div className="flex gap-1 justify-end">
                              <EditOrderDialog order={order} onUpdated={load} />
                              <CopyLinkButton token={order.tracking_token} />
                              <DeleteOrderButton order={order} onDeleted={load} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
