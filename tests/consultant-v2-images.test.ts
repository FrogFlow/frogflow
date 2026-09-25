import { describe, it, expect } from "vitest";
import { imageFromBytes, incomingImageUrls } from "../src/lib/consultant-v2/images";
import { isPublicationAttachment } from "../src/lib/zernio-message";

/** Фото покупателя в v2: что считается снимком и что уходит модели. */
describe("фото покупателя", () => {
  it("тип — по первым байтам, пустое и не картинка — нет", () => {
    expect(imageFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mediaType).toBe("image/jpeg");
    expect(imageFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))?.mediaType).toBe(
      "image/png",
    );
    expect(imageFromBytes(new Uint8Array([]))).toBeNull();
    expect(imageFromBytes(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("из вложений директа — снимки, без сторис, рилсов и гифок", () => {
    const urls = incomingImageUrls(
      [
        { type: "image", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" },
        { type: "image", url: "https://www.instagram.com/stories/bovi_kz/123/" },
        { type: "image", url: "https://media.giphy.com/media/x/giphy.gif" },
        { type: "audio", url: "https://cdn/voice.mp4" },
        { type: "image", url: "https://cdn/2.jpg", payload: { story_id: "s1" } },
      ],
      isPublicationAttachment,
    );
    expect(urls).toEqual(["https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1"]);
  });
});
