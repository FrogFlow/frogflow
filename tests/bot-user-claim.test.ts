import { describe, expect, it, vi } from "vitest";

import { claimBotUserState } from "../src/lib/bot-user-claim.server";

describe("claimBotUserState", () => {
  it("returns the claimed state using a real bot_users column", async () => {
    const selected: string[] = [];
    let writtenState: unknown;
    let fromCalls = 0;

    const readQuery = {
      select(columns: string) {
        selected.push(columns);
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                state: { mode: "awaiting_proof", country_code: "KZ" },
                updated_at: "2026-08-22T16:10:27.000Z",
              },
              error: null,
            }),
          }),
        };
      },
    };

    const updateQuery = {
      update(value: { state: unknown }) {
        writtenState = value.state;
        const secondEq = {
          select(columns: string) {
            selected.push(columns);
            return {
              maybeSingle: async () => ({ data: { user_key: "wa_1" }, error: null }),
            };
          },
        };
        const firstEq = {
          eq: () => secondEq,
        };
        return {
          eq: () => firstEq,
        };
      },
    };

    const fakeDb = {
      from: vi.fn(() => (++fromCalls === 1 ? readQuery : updateQuery)),
    } as unknown as Parameters<typeof claimBotUserState>[0]["db"];

    const claimed = await claimBotUserState<{ mode: string; country_code: string }>({
      db: fakeDb,
      column: "user_key",
      value: "wa_1",
      isClaimable: (state) => state.mode === "awaiting_proof",
      claim: (state) => ({ ...state, mode: "processing_proof" }),
    });

    expect(claimed).toEqual({ mode: "awaiting_proof", country_code: "KZ" });
    expect(writtenState).toEqual({ mode: "processing_proof", country_code: "KZ" });
    expect(selected).toEqual(["state, updated_at", "user_key"]);
    expect(selected).not.toContain("id");
  });
});
