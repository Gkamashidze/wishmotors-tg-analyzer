import { NextResponse } from "next/server";

export async function GET() {
  const vars = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
    GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID,
  };

  const info: Record<string, { set: boolean; length: number; prefix: string }> = {};
  for (const [key, val] of Object.entries(vars)) {
    const trimmed = (val ?? "").trim();
    info[key] = {
      set: trimmed.length > 0,
      length: trimmed.length,
      prefix: trimmed.slice(0, 8),
    };
  }

  // test token refresh
  const clientId = (vars.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (vars.GOOGLE_CLIENT_SECRET ?? "").trim();
  const refreshToken = (vars.GOOGLE_REFRESH_TOKEN ?? "").trim();

  let tokenTest: string;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
    tokenTest = data.access_token ? "OK" : `FAIL: ${data.error} — ${data.error_description ?? ""}`;
  } catch (e) {
    tokenTest = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({ vars: info, tokenTest });
}
