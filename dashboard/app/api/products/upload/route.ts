import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";
import { randomUUID } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function getDriveClient() {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN ?? "").trim();
  const folderId = (process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();
  if (!clientId || !clientSecret || !refreshToken || !folderId) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return { drive: google.drive({ version: "v3", auth }), folderId };
}

export async function POST(req: NextRequest) {
  const client = getDriveClient();
  if (!client) {
    return NextResponse.json(
      { error: "Google Drive არ არის კონფიგურირებული" },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "ფაილი ვერ წაიკითხა" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ფაილი არ მიუწოდეთ" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "მხოლოდ JPEG, PNG, WebP ფორმატებია დასაშვები" },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "ფაილი 5MB-ზე მეტია" }, { status: 400 });
  }

  const ext = EXT_MAP[file.type] ?? "jpg";
  const buffer = Buffer.from(await file.arrayBuffer());

  const { drive, folderId } = client;

  let fileId: string;
  try {
    const created = await drive.files.create({
      requestBody: {
        name: `${randomUUID()}.${ext}`,
        parents: [folderId],
      },
      media: {
        mimeType: file.type,
        body: Readable.from(buffer),
      },
      fields: "id",
    });
    if (!created.data.id) {
      return NextResponse.json({ error: "Drive-მა ID არ დაბრუნა" }, { status: 500 });
    }
    fileId = created.data.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[upload] drive.files.create failed:", msg);
    return NextResponse.json({ error: `Drive ატვირთვა ვერ მოხერხდა: ${msg}` }, { status: 500 });
  }

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (err) {
    console.error("[upload] drive.permissions.create failed:", err);
  }

  return NextResponse.json({
    url: `https://lh3.googleusercontent.com/d/${fileId}`,
  });
}
