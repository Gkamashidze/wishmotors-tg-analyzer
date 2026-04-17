/**
 * Thin Telegram Bot API client used by Dashboard API routes to keep
 * group-topic messages in sync when records are edited or deleted from the web.
 *
 * Mirrors the bot-side helpers in bot/handlers/topic_messages.py:
 *   - mark_cancelled  →  telegramMarkCancelled
 *   - mark_updated    →  telegramMarkUpdated
 *
 * All calls are best-effort: benign Telegram errors (message not found,
 * too old to edit, already deleted) are logged and swallowed so a stale
 * topic post never blocks a DB operation.
 */

function getTgApiBase(): string | null {
  const token = process.env.BOT_TOKEN;
  return token ? `https://api.telegram.org/bot${token}` : null;
}

const CANCELLED_BANNER = "❌ <b>გაუქმებულია (ვებ-დაფიდან)</b>";
const UPDATED_BANNER = "✏️ <b>შეცვლილია (ვებ-დაფიდან)</b>";
const MAX_LEN = 4000;

const BENIGN_ERRORS = [
  "message to edit not found",
  "message can't be edited",
  "message is not modified",
];

function truncate(text: string): string {
  return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
}

async function tgRequest(
  method: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const TG_API_BASE = getTgApiBase();
  if (!TG_API_BASE) {
    console.warn("[telegram] BOT_TOKEN not set — skipping Telegram sync");
    return false;
  }
  try {
    const res = await fetch(`${TG_API_BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      const desc = (data.description ?? "").toLowerCase();
      if (BENIGN_ERRORS.some((b) => desc.includes(b))) {
        console.info("[telegram] benign error (ignored): %s", data.description);
        return false;
      }
      console.warn("[telegram] API error in %s: %s", method, data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[telegram] request failed (%s):", method, err);
    return false;
  }
}

export async function telegramMarkCancelled(
  chatId: number,
  messageId: number,
  originalText: string,
): Promise<boolean> {
  return tgRequest("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: truncate(`${CANCELLED_BANNER}\n\n${originalText}`),
    parse_mode: "HTML",
  });
}

export async function telegramMarkUpdated(
  chatId: number,
  messageId: number,
  newText: string,
): Promise<boolean> {
  return tgRequest("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: truncate(`${UPDATED_BANNER}\n\n${newText}`),
    parse_mode: "HTML",
  });
}
