import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-session.server";

/**
 * Правила «ответить на комментарий, в Direct не писать» — чтение и запись из
 * панели. Логика в comment-reply-rules.ts, хранение в …server.ts.
 */
export const listCommentReplyRulesFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { loadCommentReplyRules } = await import("./comment-reply-rules.server");
  return await loadCommentReplyRules();
});

export const saveCommentReplyRuleFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      keywords: z.array(z.string()),
      matchMode: z.enum(["exact", "contains"]),
      platformPostId: z.string().nullable().optional(),
      replies: z.array(z.string()),
      isActive: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { saveCommentReplyRule } = await import("./comment-reply-rules.server");
    return await saveCommentReplyRule(data);
  });

export const deleteCommentReplyRuleFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { deleteCommentReplyRule } = await import("./comment-reply-rules.server");
    await deleteCommentReplyRule(data.id);
    return { ok: true as const };
  });
