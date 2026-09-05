import { describe, expect, it } from "vitest";
import {
  describeAutomationTargetIds,
  describePostMediaKind,
  isInstagramMediaId,
  isZernioObjectId,
  pickZernioPostId,
} from "../src/lib/zernio-post-ids";

describe("pickZernioPostId", () => {
  it("берёт analytics.postId — в доке Zernio это id поста", () => {
    expect(
      pickZernioPostId({
        postId: "65f1c0a9e2b5af0012ab34cd",
        latePostId: "late-should-be-ignored",
        id: "17942086977344770",
      }),
    ).toBe("65f1c0a9e2b5af0012ab34cd");
  });

  it("не подставляет Instagram media id вместо id Zernio", () => {
    expect(
      pickZernioPostId({
        postId: "17942086977344770",
        _id: "18121857844889708",
        id: "17942086977344770",
        latePostId: "6a9b970a83a464fd98bd41b4",
      }),
    ).toBeNull();
  });

  it("не берёт latePostId — это id издателя, не поста", () => {
    expect(pickZernioPostId({ latePostId: "65f1c0a9e2b5af0012ab34cd" })).toBeNull();
  });

  it("принимает _id из GET /posts", () => {
    expect(pickZernioPostId({ _id: "65f1c0a9e2b5af0012ab34cd" })).toBe("65f1c0a9e2b5af0012ab34cd");
  });
});

describe("id shape", () => {
  it("отличает media id Instagram от ObjectId Zernio", () => {
    expect(isInstagramMediaId("17942086977344770")).toBe(true);
    expect(isInstagramMediaId("65f1c0a9e2b5af0012ab34cd")).toBe(false);
    expect(isZernioObjectId("65f1c0a9e2b5af0012ab34cd")).toBe(true);
    expect(isZernioObjectId("17942086977344770")).toBe(false);
  });
});

describe("describeAutomationTargetIds", () => {
  it("помечает правило, где в postId лежит Instagram id", () => {
    expect(describeAutomationTargetIds("17942086977344770", "17942086977344770")).toMatch(
      /Instagram id/,
    );
  });

  it("помечает правило без postId", () => {
    expect(describeAutomationTargetIds("17942086977344770", null)).toMatch(/нет id Zernio/);
  });

  it("не ругается на нормальную пару", () => {
    expect(describeAutomationTargetIds("17942086977344770", "65f1c0a9e2b5af0012ab34cd")).toBe(
      "target=17942086977344770 zernioPost=65f1c0a9e2b5af0012ab34cd",
    );
  });
});

describe("describePostMediaKind", () => {
  it("отделяет Reels от фото", () => {
    expect(describePostMediaKind({ mediaProductType: "REELS" })).toBe("Reels");
    expect(describePostMediaKind({ mediaType: "image" })).toBe("Фото");
  });
});
