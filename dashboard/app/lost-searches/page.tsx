import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLostSearches, type LostSearchRow } from "@/lib/queries";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ka-GE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  searchParams: Promise<{ days?: string }>;
};

export default async function LostSearchesPage({ searchParams }: Props) {
  const params = await searchParams;
  const days = params.days === "7" ? 7 : 30;
  const rows = await getLostSearches(days);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="ვერ-ნაპოვნი ძიებები" />

      <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {/* Tab selector */}
        <div className="flex gap-2">
          <a
            href="?days=30"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              days === 30
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            ბოლო 30 დღე
          </a>
          <a
            href="?days=7"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              days === 7
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            ბოლო 7 დღე
          </a>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              ვერ-ნაპოვნი ძიებები — ბოლო {days} დღე
              {rows.length > 0 && (
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  {rows.length} განსხვავებული ძიება
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                ჯერ ძიება არ დაფიქსირებულა
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium w-10">#</th>
                      <th className="pb-2 pr-4 font-medium">ძიება</th>
                      <th className="pb-2 pr-4 font-medium text-right">რაოდენობა</th>
                      <th className="pb-2 font-medium text-right">ბოლო ძიება</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row: LostSearchRow, idx: number) => (
                      <tr
                        key={row.query}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-2 pr-4 text-muted-foreground">{idx + 1}</td>
                        <td className="py-2 pr-4 font-medium">{row.query}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-semibold">
                            {row.searches}
                          </span>
                        </td>
                        <td className="py-2 text-right text-muted-foreground tabular-nums">
                          {formatDate(row.lastSeen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
