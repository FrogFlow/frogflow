import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, getOperatorSession } from "./guard.server";
import { broadcastToOwners, listBroadcasts } from "./broadcast.server";

const BroadcastInput = z.object({
  botIds: z.array(z.string().uuid()).min(1),
  text: z.string().min(1),
});

export const broadcastToOwnersFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => BroadcastInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    const s = await getOperatorSession();
    return broadcastToOwners(data.botIds, data.text, s.data.username || "operator");
  });

export const listBroadcastsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return listBroadcasts();
});
