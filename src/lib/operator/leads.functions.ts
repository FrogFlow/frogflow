import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, getOperatorSession } from "./guard.server";
import {
  listLeads,
  funnelCounts,
  createLead,
  updateLeadStage,
  updateLeadNotes,
  deleteLead,
  scoreLead,
  generateDraft,
  isLeadsAiConfigured,
  huntLeads,
  processPipeline,
  markContacted,
  markFollowUpSent,
  pipelineStatus,
  savePipelineSettings,
  listLeadEvents,
  LEAD_STAGES,
  type LeadStage,
} from "./leads.server";

async function actor(): Promise<string> {
  const s = await getOperatorSession();
  return s.data.username || "operator";
}

const StageEnum = z.enum(LEAD_STAGES as [string, ...string[]]);

export const listLeadsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    z.object({ stage: StageEnum.optional(), q: z.string().max(200).optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return listLeads({ stage: data.stage as LeadStage | undefined, q: data.q });
  });

export const funnelCountsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return funnelCounts();
});

export const leadsAiConfiguredFn = createServerFn({ method: "GET" }).handler(async () => {
  return isLeadsAiConfigured();
});

export const pipelineStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  return pipelineStatus();
});

export const listLeadEventsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    return listLeadEvents(data.id);
  });

export const createLeadFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        business_name: z.string().min(1).max(200),
        niche: z.string().max(200).nullable().optional(),
        city: z.string().max(200).nullable().optional(),
        website_url: z.string().max(500).nullable().optional(),
        instagram_handle: z.string().max(200).nullable().optional(),
        phone: z.string().max(100).nullable().optional(),
        email: z.string().max(200).nullable().optional(),
        signals: z.string().max(2000).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return createLead(data, await actor());
  });

export const updateLeadStageFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid(), stage: StageEnum }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    await updateLeadStage(data.id, data.stage as (typeof LEAD_STAGES)[number], await actor());
    return { ok: true as const };
  });

export const updateLeadNotesFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), notes: z.string().max(2000) }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    await updateLeadNotes(data.id, data.notes);
    return { ok: true as const };
  });

export const deleteLeadFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    await deleteLead(data.id);
    return { ok: true as const };
  });

export const scoreLeadFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return scoreLead(data.id);
  });

export const generateDraftFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return generateDraft(data.id);
  });

export const huntLeadsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ query: z.string().max(300).nullable().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return huntLeads({ query: data.query, actor: await actor() });
  });

export const processPipelineFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireOperator();
  return processPipeline(await actor());
});

export const markContactedFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), channel: z.string().max(40).nullable().optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    await markContacted(data.id, await actor(), data.channel);
    return { ok: true as const };
  });

export const markFollowUpSentFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    await markFollowUpSent(data.id, await actor());
    return { ok: true as const };
  });

export const savePipelineSettingsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        qualifyMinScore: z.number().int().min(50).max(99).optional(),
        rejectMaxScore: z.number().int().min(0).max(70).optional(),
        followUpDays: z.number().int().min(1).max(14).optional(),
        maxFollowUps: z.number().int().min(0).max(5).optional(),
        autoHunt: z.boolean().optional(),
        autoEmail: z.boolean().optional(),
        lostAfterDays: z.number().int().min(7).max(90).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return savePipelineSettings(data);
  });
