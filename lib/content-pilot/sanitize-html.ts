// Sanitize AI-generated HTML before rendering it in a preview. This is a
// defence-in-depth allow-ish filter (the content is operator-authored for their
// own store), not a substitute for a full sanitizer like DOMPurify.
//
// Shared by the draft review page and the proposals queue inline preview so
// both render AI HTML through the exact same filter.
const DANGEROUS_TAGS =
  "script, style, iframe, object, embed, link, meta, base, form, input, button, svg, math";
const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:|\/|#)/i;

export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(DANGEROUS_TAGS).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // Strip every event handler (onclick, onerror, onmouseover, …) and inline styles.
      if (name.startsWith("on") || name === "style" || name === "srcdoc") {
        el.removeAttribute(attr.name);
        continue;
      }
      // Only allow safe URL schemes on href/src; reject javascript:, data:, vbscript:, etc.
      if ((name === "href" || name === "src") && !SAFE_URL_SCHEMES.test(attr.value.trim())) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}
