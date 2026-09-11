const INJECTION_RE =
  /ignore (all )?(previous|above)|забыть (все )?инструкции|reveal (the )?(system )?prompt|покажи (системн|промпт)|api[_-]?key|anthropic|you are now|jailbreak|developer mode/i;

export function looksLikePromptInjection(text: string): boolean {
  return INJECTION_RE.test(text);
}
