import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

type Params = Promise<{ id: string }>;

const SYSTEM_PROMPT = `შენ ხარ WishMotors-ის კოპირაიტერი. წერ ავტონაწილების მოკლე, გასაგებ, გრამატიკულად უნაკლო მარკეტინგულ აღწერებს ქართულ ენაზე.

ენობრივი წესები:
- წინადადებები გრამატიკულად სწორი უნდა იყოს — შეამოწმე მსჯელობა, ბრუნვები, სახელები.
- ბარბარიზმები დაუშვებელია: ნუ იხმარ რუსული წარმომავლობის სიტყვებს. მაგ: ნაბეჟნიკი → საკისარი; შარნილი → სახსარი; ამორტი → ამორტიზატორი; ვტულკა → ბუჩქი; ბალანსირი → სტაბილიზატორი; სტოიკა → საყრდენი სვეტი.
- სტილი: მოკლე, პირდაპირი — 1–2 წინადადება, მაქსიმუმ 160 სიმბოლო.
- ტონი: პრაქტიკული, არა ზედმეტი ეპითეტები, არა ზმნა "მიეწოდება".

შინაარსი:
- დაასახელე პირდაპირ: რისთვის არის, რომელ მანქანაზე / სისტემაში.
- მყიდველს სახელი/კოდი უკვე ეცოდინება — ახსენი მხოლოდ სარგებელი.
- ფასი, SKU, OEM კოდი — არ ახსენო.

ფორმატი:
- მხოლოდ ტექსტი — HTML, markdown, ბრჭყალები — არ გამოიყენო.
- პასუხი: მხოლოდ და მხოლოდ მზა აღწერა, სხვა არაფერი.

კარგი აღწერის მაგალითი (ბრჭყალების გარეშე):
SsangYong Rexton-ის წინა ბორბლის საკისარი. ცვლის გაცვეთილ ელემენტს — ხმაური ან ვიბრაცია ბორბლის მხრიდან. OEM ზომები, პირდაპირი ჩასმა.`;


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
    unit: string;
    oem_code: string | null;
  }>(
    `SELECT name, category, unit, oem_code
     FROM products WHERE id = $1`,
    [productId],
  );

  if (!product) {
    return NextResponse.json({ error: "პროდუქტი ვერ მოიძებნა" }, { status: 404 });
  }

  const lines: string[] = [`სახელი: ${product.name}`];
  if (product.category) lines.push(`კატეგორია: ${product.category}`);
  if (product.unit) lines.push(`ერთეული: ${product.unit}`);

  const userMessage = `პროდუქტის მონაცემები:\n${lines.join("\n")}\n\nდაწერე მოკლე მარკეტინგული აღწერა.`;

  try {
    const client = new Anthropic({ apiKey, timeout: 30_000 });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      temperature: 0.3,
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
