import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";
import { randomUUID } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID ?? "";
  if (!raw || !folderId) return null;

  const credentials = JSON.parse(raw) as object;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
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

  const fileId = created.data.id;
  if (!fileId) {
    return NextResponse.json({ error: "ატვირთვა ვერ მოხერხდა" }, { status: 500 });
  }

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  return NextResponse.json({
    url: `https://lh3.googleusercontent.com/d/${fileId}`,
  });
}
