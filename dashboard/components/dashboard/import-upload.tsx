"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; saved: number; skipped: number; errors: string[] }
  | { status: "error"; message: string };

export function ImportUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setState({ status: "error", message: "მხოლოდ .xlsx ფორმატია მიღებული" });
      return;
    }

    setState({ status: "uploading" });

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/imports", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok) {
        setState({ status: "error", message: json.error ?? "სერვერის შეცდომა" });
        return;
      }

      setState({
        status: "success",
        saved: json.saved ?? 0,
        skipped: json.skipped ?? 0,
        errors: json.errors ?? [],
      });
      router.refresh();
    } catch {
      setState({ status: "error", message: "ქსელის შეცდომა — სცადე ხელახლა" });
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }

  const isUploading = state.status === "uploading";

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 hover:border-primary/50",
          isUploading && "pointer-events-none opacity-60",
        )}
        onClick={() => !isUploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={onFileChange}
        />

        <div className="flex flex-col items-center gap-3">
          {isUploading ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : (
            <Upload className="h-10 w-10 text-muted-foreground" />
          )}
          <div>
            <p className="font-medium text-sm">
              {isUploading ? "იტვირთება..." : "გადმოათრიე .xlsx ფაილი ან დააჭირე"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              მხოლოდ Excel (.xlsx) ფაილი
            </p>
          </div>
        </div>
      </div>

      {!isUploading && state.status !== "idle" && (
        <div
          className={cn(
            "rounded-lg p-4 text-sm space-y-2",
            state.status === "success"
              ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800",
          )}
        >
          {state.status === "success" ? (
            <>
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle className="h-4 w-4" />
                იმპორტი წარმატებით დასრულდა
              </div>
              <ul className="list-none space-y-0.5 pl-6">
                <li>შენახული ჩანაწერი: <strong>{state.saved}</strong></li>
                {state.skipped > 0 && (
                  <li>გამოტოვებული: <strong>{state.skipped}</strong></li>
                )}
              </ul>
              {state.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs opacity-70">
                    გამოტოვებული სტრიქონები ({state.errors.length})
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs opacity-80 list-disc pl-4">
                    {state.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {state.errors.length > 10 && (
                      <li>… და კიდევ {state.errors.length - 10}</li>
                    )}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>{state.message}</span>
            </div>
          )}
        </div>
      )}

      {state.status !== "idle" && !isUploading && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setState({ status: "idle" })}
        >
          ახალი ფაილის ატვირთვა
        </Button>
      )}
    </div>
  );
}
