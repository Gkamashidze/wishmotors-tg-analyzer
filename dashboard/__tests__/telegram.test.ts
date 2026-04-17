import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { telegramMarkCancelled, telegramMarkUpdated } from "../lib/telegram";

const CHAT_ID = -1002538412411;
const MSG_ID = 999;

function mockFetch(ok: boolean, description?: string) {
  return vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok, description }),
  });
}

beforeEach(() => {
  process.env.BOT_TOKEN = "123:TEST_TOKEN";
  process.env.GROUP_ID = String(CHAT_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BOT_TOKEN;
  delete process.env.GROUP_ID;
});

describe("telegramMarkCancelled", () => {
  it("calls editMessageText with cancellation banner", async () => {
    const fetchMock = mockFetch(true);
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkCancelled(CHAT_ID, MSG_ID, "original text");

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("editMessageText");

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.message_id).toBe(MSG_ID);
    expect(body.parse_mode).toBe("HTML");
    expect(String(body.text)).toContain("გაუქმებულია");
    expect(String(body.text)).toContain("original text");
  });

  it("returns false when BOT_TOKEN is not set", async () => {
    delete process.env.BOT_TOKEN;
    const fetchMock = mockFetch(true);
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkCancelled(CHAT_ID, MSG_ID, "text");

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false and swallows 'message to edit not found' error", async () => {
    const fetchMock = mockFetch(false, "Bad Request: message to edit not found");
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkCancelled(CHAT_ID, MSG_ID, "text");

    expect(result).toBe(false);
  });

  it("returns false and swallows 'message can't be edited' error", async () => {
    const fetchMock = mockFetch(false, "Bad Request: message can't be edited");
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkCancelled(CHAT_ID, MSG_ID, "text");

    expect(result).toBe(false);
  });

  it("returns false and swallows 'message is not modified' error", async () => {
    const fetchMock = mockFetch(false, "Bad Request: message is not modified");
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkCancelled(CHAT_ID, MSG_ID, "text");

    expect(result).toBe(false);
  });

  it("returns false when fetch throws a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkCancelled(CHAT_ID, MSG_ID, "text");

    expect(result).toBe(false);
  });

  it("truncates text longer than 4000 characters", async () => {
    const fetchMock = mockFetch(true);
    vi.stubGlobal("fetch", fetchMock);

    const longText = "x".repeat(4100);
    await telegramMarkCancelled(CHAT_ID, MSG_ID, longText);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(String(body.text).length).toBeLessThanOrEqual(4001);
    expect(String(body.text)).toMatch(/…$/);
  });
});

describe("telegramMarkUpdated", () => {
  it("calls editMessageText with updated banner", async () => {
    const fetchMock = mockFetch(true);
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkUpdated(CHAT_ID, MSG_ID, "new content");

    expect(result).toBe(true);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(String(body.text)).toContain("შეცვლილია");
    expect(String(body.text)).toContain("new content");
    expect(body.parse_mode).toBe("HTML");
  });

  it("returns false when Telegram returns unexpected error", async () => {
    const fetchMock = mockFetch(false, "Unauthorized");
    vi.stubGlobal("fetch", fetchMock);

    const result = await telegramMarkUpdated(CHAT_ID, MSG_ID, "text");

    expect(result).toBe(false);
  });
});
