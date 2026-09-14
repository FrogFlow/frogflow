export async function notifyConsultantHandoff(params: {
  userKey: string;
  reason: string;
  text: string;
}): Promise<void> {
  try {
    const { notifyOwner } = await import("@/lib/internal/internal-api.server");
    const res = await notifyOwner(
      `Консультант: диалог ${params.userKey}\nПричина: ${params.reason}\n<${params.text.slice(0, 200)}>`
    );
    console.log("[notifyConsultantHandoff] response:", res);
  } catch (e) {
    console.error("[notifyConsultantHandoff] error:", e);
  }
}
