import { useEffect } from "react";
import type { Locale } from "@/lib/i18n";

const originals = new WeakMap<Text, string>();

/**
 * Localises every visible Russian UI label in the admin area, including labels
 * returned after navigation or data refresh.  Form values are deliberately not
 * touched: product names, descriptions and payment details belong to the shop.
 */
export function AdminAutoTranslator({ locale }: { locale: Locale }) {
  useEffect(() => {
    let cancelled = false;

    const collect = (root: ParentNode) => {
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (
        let node = walker.nextNode() as Text | null;
        node;
        node = walker.nextNode() as Text | null
      ) {
        const parent = node.parentElement;
        if (
          !parent ||
          parent.closest(
            "input, textarea, select, option, script, style, code, pre, [data-no-translate]",
          )
        )
          continue;
        const source = originals.get(node) ?? node.data;
        if (!originals.has(node)) originals.set(node, source);
        if (/\p{Script=Cyrillic}/u.test(source)) nodes.push(node);
      }
      return nodes;
    };

    async function translate(nodes: Text[]) {
      if (locale === "ru") return;
      // Small batches prevent a page with many hints from monopolising the network.
      for (let i = 0; i < nodes.length; i += 20) {
        const batch = nodes.slice(i, i + 20);
        await Promise.all(
          batch.map(async (node) => {
            const query = new URLSearchParams({
              client: "gtx",
              sl: "ru",
              tl: locale === "kk" ? "kk" : locale,
              dt: "t",
              q: originals.get(node) ?? node.data,
            });
            try {
              const response = await fetch(
                `https://translate.googleapis.com/translate_a/single?${query}`,
              );
              const payload = (await response.json()) as Array<Array<[string]>>;
              const value = payload[0]?.map((part) => part[0]).join("");
              if (!cancelled && value) node.data = value;
            } catch {
              // Keep the original Russian text if translation is temporarily unavailable.
            }
          }),
        );
        if (cancelled) return;
      }
    }

    const refresh = () => {
      const nodes = collect(document.body);
      if (locale === "ru") {
        nodes.forEach((node) => {
          const value = originals.get(node);
          if (value) node.data = value;
        });
      } else void translate(nodes);
    };
    refresh();
    const observer = new MutationObserver(() => refresh());
    observer.observe(document.body, { childList: true, subtree: true, characterData: false });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [locale]);
  return null;
}
