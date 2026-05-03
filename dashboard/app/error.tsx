"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-semibold text-destructive">შეცდომა მოხდა</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        გვერდი ვერ ჩაიტვირთა. სცადე ხელახლა ან დაბრუნდი მთავარ გვერდზე.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        ხელახლა სცადე
      </button>
    </div>
  );
}
