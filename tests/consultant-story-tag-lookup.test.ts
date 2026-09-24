import { describe, it, expect, vi } from "vitest";
import { isPublicationAttachment } from "../src/lib/zernio-message";

/**
 * Живой случай 24.09: двое прислали фото полотенец (Pip Studio, жаккард),
 * поиск привязки по фото ничего не нашёл и подставил последнюю отмеченную
 * публикацию — список из 14 ковриков Kleen-Tex. Менеджер потом отвечал сама.
 */

const kleenTex = {
  story_id: "Dbu9QJzR487",
  story_url: "https://www.instagram.com/reel/Dbu9QJzR487/",
  product_name: "Kleen-Tex коврик в прихожую 120x180, цветной",
};

/** Любой запрос по условию ничего не находит; «последняя отметка» есть всегда. */
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {
    select: () => c,
    eq: () => c,
    ilike: () => c,
    or: () => c,
    order: () => ({ ...c, filtered: false }),
    limit: () => c,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return c;
}
let latestTagQueried = false;
vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseService: {
    from: () => {
      const c = chain();
      c.order = () => {
        latestTagQueried = true;
        return { limit: () => ({ maybeSingle: async () => ({ data: kleenTex, error: null }) }) };
      };
      return c;
    },
  },
}));

describe("findStoryTag", () => {
  it("фото покупателя без привязки — не находим ничего, а не последнюю отметку", async () => {
    const { findStoryTag } = await import("../src/lib/consultant/story-tags.functions");
    const tag = await findStoryTag(
      null,
      "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1526263939268312&signature=Ab1mWg",
    );
    expect(tag).toBeNull();
    expect(latestTagQueried).toBe(false);
  });
});

describe("isPublicationAttachment", () => {
  it("фото и видео из директа — файл покупателя", () => {
    expect(isPublicationAttachment("image", "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1")).toBe(false);
    expect(isPublicationAttachment("video", "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2")).toBe(false);
    expect(isPublicationAttachment("image", "https://media0.giphy.com/media/x/200.gif")).toBe(false);
  });

  it("пересланный рилс и типы публикаций — публикация", () => {
    expect(
      isPublicationAttachment("video", "https://www.instagram.com/reel/Dcaih_PMAZ2/", {
        reel_video_id: "18113576638999210",
      }),
    ).toBe(true);
    expect(isPublicationAttachment("video", null, { reel_video_id: "18113576638999210" })).toBe(true);
    expect(isPublicationAttachment("story_reply", null)).toBe(true);
    expect(isPublicationAttachment("share", "https://lookaside.fbsbx.com/x")).toBe(true);
  });
});
