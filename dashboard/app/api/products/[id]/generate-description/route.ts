import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

type Params = Promise<{ id: string }>;

const SYSTEM_PROMPT = `შენ ხარ WishMotors-ის პროდუქტ-მარკეტოლოგი. შენი ამოცანაა ავტონაწილების მოკლე, გასაგები და მარკეტინგული აღწერის დაწერა ქართულ ენაზე.

წესები:
1. მხოლოდ ქართული ენა.
2. მაქსიმუმ 200 სიმბოლო.
3. დაუყვანე მყიდველს ყველაზე მნიშვნელოვანი: რისთვის გამოიყენება, რომელ მანქანებზე, ხარისხი / მახასიათებელი.
4. ტონი: მკვეთრი, პრაქტიკული — არა ზედმეტი ეპითეტები.
5. HTML-ი არ გამოიყენო.
6. არ ახსენო ფასი, SKU, OEM კოდი — მხოლოდ სამომხმარებლო სარგებელი.`;

export async function POST(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY არ არის კონფიგურირებული" }, { status: 503 });
  }

  const product = await queryOne<{
    name: string;
    category: string | null;
    compatibility_notes: string | null;
    unit: string;
    oem_code: string | null;
  }>(
    `SELECT name, category, compatibility_notes, unit, oem_code
     FROM products WHERE id = $1`,
    [productId],
  );

  if (!product) {
    return NextResponse.json({ error: "პროდუქტი ვერ მოიძებნა" }, { status: 404 });
  }

  const lines: string[] = [`სახელი: ${product.name}`];
  if (product.category) lines.push(`კატეგორია: ${product.category}`);
  if (product.compatibility_notes) lines.push(`თავსებადობა: ${product.compatibility_notes}`);
  if (product.unit) lines.push(`ერთეული: ${product.unit}`);

  const userMessage = `პროდუქტის მონაცემები:\n${lines.join("\n")}\n\nდაწერე მოკლე მარკეტინგული აღწერა.`;

  try {
    const client = new Anthropic({ apiKey, timeout: 20_000 });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      temperature: 0.5,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    let description = "";
    for (const block of msg.content) {
      if (block.type === "text") {
        description = block.text.trim().slice(0, 2000);
        break;
      }
    }

    return NextResponse.json({ description });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[generate-description] Anthropic error:", msg);
    return NextResponse.json({ error: `AI შეცდომა: ${msg}` }, { status: 500 });
  }
}
