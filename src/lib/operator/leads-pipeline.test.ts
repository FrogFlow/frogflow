import { describe, it, expect } from "vitest";
import {
  parsePipelineSettings,
  DEFAULT_PIPELINE,
  decideAfterScore,
  nextActionForStage,
  shouldFollowUp,
  shouldMarkLost,
  isActionDue,
  isDuplicate,
  normalizePhone,
  normalizeHandle,
  normalizeUrl,
  pickOutreachChannel,
  whatsappHref,
  parseExtractedLeads,
  clampCandidate,
  parseDuckDuckGoHtml,
  huntQueryForDay,
  HUNT_QUERIES,
  matchInboundLead,
  shouldPromoteToReplied,
  pickZernioAccount,
  canAutoSendChannel,
  outreachBody,
} from "./leads-pipeline";

describe("parsePipelineSettings", () => {
  it("пустая строка — дефолты", () => {
    expect(parsePipelineSettings(null)).toEqual(DEFAULT_PIPELINE);
    expect(parsePipelineSettings("")).toEqual(DEFAULT_PIPELINE);
  });

  it("ломаный JSON — дефолты, а не падение", () => {
    expect(parsePipelineSettings("{nope")).toEqual(DEFAULT_PIPELINE);
  });

  it("частичный JSON дополняется дефолтами, autoHunt по умолчанию включён", () => {
    const s = parsePipelineSettings('{"qualifyMinScore":80,"autoEmail":true}');
    expect(s.qualifyMinScore).toBe(80);
    expect(s.autoEmail).toBe(true);
    expect(s.autoHunt).toBe(true);
    expect(s.autoWhatsApp).toBe(false);
    expect(s.autoInstagram).toBe(false);
    expect(s.whatsappTemplateName).toBe("");
    expect(s.followUpDays).toBe(DEFAULT_PIPELINE.followUpDays);
  });

  it("autoHunt: false выключается явно, мессенджеры включаются явно", () => {
    expect(parsePipelineSettings('{"autoHunt":false}').autoHunt).toBe(false);
    const s = parsePipelineSettings(
      '{"autoWhatsApp":true,"autoInstagram":true,"whatsappTemplateName":"hello_world"}',
    );
    expect(s.autoWhatsApp).toBe(true);
    expect(s.autoInstagram).toBe(true);
    expect(s.whatsappTemplateName).toBe("hello_world");
  });

  it("числа зажимаются в разумный диапазон", () => {
    const s = parsePipelineSettings('{"qualifyMinScore":5,"followUpDays":99,"maxFollowUps":-3}');
    expect(s.qualifyMinScore).toBe(50);
    expect(s.followUpDays).toBe(14);
    expect(s.maxFollowUps).toBe(0);
  });
});

describe("decideAfterScore", () => {
  const s = DEFAULT_PIPELINE;
  it("высокий балл — qualify", () => {
    expect(decideAfterScore(93, s)).toBe("qualify");
    expect(decideAfterScore(75, s)).toBe("qualify");
  });
  it("низкий — reject", () => {
    expect(decideAfterScore(20, s)).toBe("reject");
    expect(decideAfterScore(45, s)).toBe("reject");
  });
  it("середина остаётся new (hold) — оператор смотрит сам", () => {
    expect(decideAfterScore(60, s)).toBe("hold");
  });
});

describe("nextActionForStage", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const s = DEFAULT_PIPELINE;

  it("qualified — написать сразу", () => {
    const n = nextActionForStage("qualified", now, s);
    expect(n.action).toMatch(/Написать/);
    expect(n.at).toBe(now.toISOString());
  });

  it("contacted — follow-up через followUpDays", () => {
    const n = nextActionForStage("contacted", now, s);
    expect(n.at).toBe("2026-09-10T12:00:00.000Z");
  });

  it("converted/lost/rejected — очередь пустая", () => {
    expect(nextActionForStage("converted", now, s)).toEqual({ action: null, at: null });
    expect(nextActionForStage("lost", now, s)).toEqual({ action: null, at: null });
    expect(nextActionForStage("rejected", now, s)).toEqual({ action: null, at: null });
  });
});

describe("shouldFollowUp / shouldMarkLost", () => {
  const s = DEFAULT_PIPELINE;
  const contacted = {
    stage: "contacted" as const,
    contacted_at: "2026-09-01T12:00:00.000Z",
    replied_at: null as string | null,
    follow_up_count: 0,
  };

  it("через 3 дня без ответа — пора дожимать", () => {
    expect(shouldFollowUp(contacted, new Date("2026-09-04T12:00:01.000Z"), s)).toBe(true);
    expect(shouldFollowUp(contacted, new Date("2026-09-03T12:00:00.000Z"), s)).toBe(false);
  });

  it("уже ответил — не дожимаем", () => {
    expect(
      shouldFollowUp(
        { ...contacted, replied_at: "2026-09-02T00:00:00.000Z" },
        new Date("2026-09-10Z"),
        s,
      ),
    ).toBe(false);
  });

  it("лимит дожимов исчерпан — не шлём ещё, но lost ещё рано", () => {
    const maxed = { ...contacted, follow_up_count: 2 };
    expect(shouldFollowUp(maxed, new Date("2026-09-20Z"), s)).toBe(false);
    expect(shouldMarkLost(maxed, new Date("2026-09-10Z"), s)).toBe(false);
    expect(shouldMarkLost(maxed, new Date("2026-09-22T12:00:01.000Z"), s)).toBe(true);
  });

  it("пока не исчерпали дожимы — не проигрываем", () => {
    expect(shouldMarkLost(contacted, new Date("2026-10-01Z"), s)).toBe(false);
  });
});

describe("isActionDue", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  it("null не due", () => expect(isActionDue(null, now)).toBe(false));
  it("прошлое — due", () => expect(isActionDue("2026-09-07T11:59:00.000Z", now)).toBe(true));
  it("будущее — нет", () => expect(isActionDue("2026-09-07T12:00:01.000Z", now)).toBe(false));
  it("ровно сейчас — due", () => expect(isActionDue(now.toISOString(), now)).toBe(true));
});

describe("dedup", () => {
  const existing = [
    {
      business_name: "Vanilla Cake",
      website_url: "https://vanilla.az/",
      instagram_handle: "@vanilla_cake_az",
      phone: "+994 55 215 63 43",
      email: null,
    },
  ];

  it("то же имя", () => {
    expect(isDuplicate({ business_name: "vanilla cake" }, existing)).toBe(true);
  });
  it("тот же сайт без схемы и слеша", () => {
    expect(
      isDuplicate({ business_name: "Другое", website_url: "http://www.vanilla.az" }, existing),
    ).toBe(true);
  });
  it("тот же Instagram без @", () => {
    expect(isDuplicate({ business_name: "x", instagram_handle: "vanilla_cake_az" }, existing)).toBe(
      true,
    );
  });
  it("тот же телефон в другом формате", () => {
    expect(isDuplicate({ business_name: "x", phone: "994552156343" }, existing)).toBe(true);
  });
  it("новый бизнес проходит", () => {
    expect(
      isDuplicate(
        { business_name: "A² Studio", website_url: "https://a2studio.kz/", phone: "+77072400669" },
        existing,
      ),
    ).toBe(false);
  });
});

describe("normalizePhone / handle / url", () => {
  it("KZ 8… → 7…", () => expect(normalizePhone("8 778 999 93 19")).toBe("77789999319"));
  it("уже +7", () => expect(normalizePhone("+7 778 999 93 19")).toBe("77789999319"));
  it("handle без @", () => expect(normalizeHandle("@Foo.Bar/")).toBe("foo.bar"));
  it("url без www и хвоста", () =>
    expect(normalizeUrl("https://www.X.kz/path/")).toBe("x.kz/path"));
});

describe("pickOutreachChannel / whatsappHref", () => {
  it("телефон важнее почты — ICP живёт в WhatsApp", () => {
    expect(pickOutreachChannel({ phone: "+7 1", email: "a@b.c", instagram_handle: "@x" })).toBe(
      "whatsapp",
    );
  });
  it("нет телефона — почта, потом Instagram", () => {
    expect(pickOutreachChannel({ phone: null, email: "a@b.c", instagram_handle: "@x" })).toBe(
      "email",
    );
    expect(pickOutreachChannel({ phone: null, email: null, instagram_handle: "@x" })).toBe(
      "instagram",
    );
    expect(pickOutreachChannel({ phone: null, email: null, instagram_handle: null })).toBe("none");
  });
  it("wa.me с текстом", () => {
    const href = whatsappHref("+7 (778) 999-93-19", "Привет");
    expect(href).toBe("https://wa.me/77789999319?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
  });
});

describe("parseExtractedLeads", () => {
  it("чистый массив", () => {
    const rows = parseExtractedLeads(
      `[{"business_name":"A","website_url":"https://a.kz","signals":"WhatsApp"}]`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.business_name).toBe("A");
  });
  it(" suffixed болтовнёй и fence", () => {
    const rows = parseExtractedLeads(
      'Вот:\n```json\n[{"business_name":"B","phone":"+7701"}]\n```\nготово',
    );
    expect(rows[0]?.business_name).toBe("B");
  });
  it("без контакта отбрасываем — иначе очередь из названий без куда писать", () => {
    expect(parseExtractedLeads(`[{"business_name":"Пустышка","niche":"торты"}]`)).toEqual([]);
  });
  it("clampCandidate режет слишком длинное имя", () => {
    const c = clampCandidate({
      business_name: "x".repeat(300),
      phone: "+1",
    });
    expect(c?.business_name).toHaveLength(200);
  });
});

describe("parseDuckDuckGoHtml", () => {
  it("достаёт title/url/snippet из классической вёрстки", () => {
    const html = `
      <a rel="nofollow" class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fvanilla.az%2F">Vanilla Cake</a>
      <a class="result__snippet" href="#">Одно сообщение WhatsApp — один торт</a>
    `;
    const hits = parseDuckDuckGoHtml(html);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toBe("https://vanilla.az/");
    expect(hits[0]?.title).toBe("Vanilla Cake");
    expect(hits[0]?.snippet).toMatch(/WhatsApp/);
  });
});

describe("huntQueryForDay", () => {
  it("стабилен в пределах суток и крутится по кругу", () => {
    const a = huntQueryForDay(new Date("2026-09-07T00:00:00Z"));
    const b = huntQueryForDay(new Date("2026-09-07T23:59:59Z"));
    expect(a).toBe(b);
    expect(HUNT_QUERIES).toContain(a);
    const next = huntQueryForDay(new Date("2026-09-08T00:00:00Z"));
    expect(next).not.toBe(a);
  });
});

describe("matchInboundLead", () => {
  const leads = [
    {
      id: "a",
      stage: "contacted",
      conversation_id: "conv-wa-1",
      phone: "+7 778 999 93 19",
      instagram_handle: "@cake_almaty",
    },
    {
      id: "b",
      stage: "qualified",
      conversation_id: null,
      phone: null,
      instagram_handle: "@flowers_tashkent",
    },
    {
      id: "c",
      stage: "converted",
      conversation_id: "conv-old",
      phone: "77011111111",
      instagram_handle: "@closed",
    },
  ];

  it("сначала диалог", () => {
    expect(matchInboundLead({ conversationId: "conv-wa-1", phone: "77011111111" }, leads)?.id).toBe(
      "a",
    );
  });

  it("телефон в другом формате", () => {
    expect(matchInboundLead({ phone: "8 (778) 999-93-19" }, leads)?.id).toBe("a");
  });

  it("instagram без @", () => {
    expect(matchInboundLead({ username: "flowers_tashkent" }, leads)?.id).toBe("b");
  });

  it("закрытую сделку не поднимаем", () => {
    expect(matchInboundLead({ conversationId: "conv-old" }, leads)).toBeNull();
    expect(matchInboundLead({ phone: "77011111111" }, leads)).toBeNull();
  });

  it("пустые иголки не матчятся со всеми", () => {
    expect(matchInboundLead({}, leads)).toBeNull();
    expect(matchInboundLead({ phone: "12" }, leads)).toBeNull();
  });
});

describe("shouldPromoteToReplied / pickZernioAccount / auto send", () => {
  it("не понижает hot и не трогает converted", () => {
    expect(shouldPromoteToReplied("contacted")).toBe(true);
    expect(shouldPromoteToReplied("qualified")).toBe(true);
    expect(shouldPromoteToReplied("hot")).toBe(false);
    expect(shouldPromoteToReplied("converted")).toBe(false);
  });

  it("берёт живой аккаунт платформы, предпочитает сохранённый id", () => {
    const accounts = [
      { _id: "ig1", platform: "instagram", isExpired: true },
      { _id: "wa1", platform: "whatsapp" },
      { _id: "wa2", platform: "whatsapp" },
      { _id: "ig2", platform: "instagram" },
    ];
    expect(pickZernioAccount(accounts, "whatsapp")?._id).toBe("wa1");
    expect(pickZernioAccount(accounts, "whatsapp", "wa2")?._id).toBe("wa2");
    expect(pickZernioAccount(accounts, "instagram")?._id).toBe("ig2");
    expect(pickZernioAccount(accounts, "instagram", "ig1")?._id).toBe("ig2");
  });

  it("авто-отправка только с явным тумблером", () => {
    expect(canAutoSendChannel("whatsapp", DEFAULT_PIPELINE)).toBe(false);
    expect(canAutoSendChannel("whatsapp", { ...DEFAULT_PIPELINE, autoWhatsApp: true })).toBe(true);
    expect(canAutoSendChannel("email", { ...DEFAULT_PIPELINE, autoEmail: true })).toBe(true);
    expect(canAutoSendChannel("none", { ...DEFAULT_PIPELINE, autoWhatsApp: true })).toBe(false);
  });

  it("дожим берёт follow_up_draft, иначе первое письмо", () => {
    expect(
      outreachBody({
        stage: "contacted",
        draft_message: "первое",
        follow_up_draft: "дожим",
      }),
    ).toBe("дожим");
    expect(
      outreachBody({ stage: "qualified", draft_message: "первое", follow_up_draft: "дожим" }),
    ).toBe("первое");
  });
});
