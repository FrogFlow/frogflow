export async function notifyConsultantHandoff(params: {
  userKey: string;
  reason: string;
  text: string;
}): Promise<void> {
  try {
    const { notifyOwner } = await import("@/lib/internal/internal-api.server");
    await notifyOwner(
      `Консультант: клиент ${params.userKey}\nПричина: ${params.reason}\n«${params.text.slice(0, 200)}»`,
    );
  } catch {
    /* владелец может быть не привязан */
  }
}
