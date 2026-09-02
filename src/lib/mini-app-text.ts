const URL_RE = /(?:https?:\/\/|www\.|pay\.kaspi\.kz\/)[^\s<>"']+/gi;
const TRAILING_PUNCT_RE = /[),.;!?]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Turn payment-instruction URLs (including Kaspi Pay) into clickable anchors. */
export function linkifyPaymentInstructions(text: string): string {
  const source = String(text || "");
  let html = "";
  let last = 0;
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null = URL_RE.exec(source);
  while (match) {
    const index = match.index;
    html += escapeHtml(source.slice(last, index));
    const trailing = (match[0].match(TRAILING_PUNCT_RE) || [""])[0];
    const raw = trailing ? match[0].slice(0, -trailing.length) : match[0];
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    html += `<a href="${escapeHtml(href)}" data-external="1" rel="noopener noreferrer">${escapeHtml(raw)}</a>${escapeHtml(trailing)}`;
    last = index + match[0].length;
    match = URL_RE.exec(source);
  }
  return html + escapeHtml(source.slice(last));
}
