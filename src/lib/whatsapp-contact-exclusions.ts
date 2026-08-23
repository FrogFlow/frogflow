function phoneKeys(value: string): string[] {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return [];

  const keys = new Set([digits]);
  // Kazakhstan and Russia commonly write the same number as +7… or 8….
  if (digits.length === 11 && digits.startsWith("8")) keys.add(`7${digits.slice(1)}`);
  if (digits.length === 10) keys.add(`7${digits}`);
  return [...keys];
}

export function normalizeExcludedWhatsAppPhones(value: string): string[] {
  const normalized = new Set<string>();
  for (const entry of value.split(/[\n,;]+/)) {
    const keys = phoneKeys(entry);
    if (keys.length > 0) normalized.add(keys.at(-1)!);
  }
  return [...normalized];
}

export function isExcludedWhatsAppSender(params: {
  senderPhone?: string | null;
  senderId?: string | null;
  excludedPhones: string;
}): boolean {
  const excluded = new Set(normalizeExcludedWhatsAppPhones(params.excludedPhones));
  if (excluded.size === 0) return false;

  return [params.senderPhone, params.senderId]
    .filter((value): value is string => Boolean(value))
    .some((value) => phoneKeys(value).some((key) => excluded.has(key)));
}
