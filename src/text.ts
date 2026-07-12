/** Shared HTML-to-text helpers. Two variants on one entity decoder:
 *  htmlToPlain for short inline `_html` fields (tags removed outright so
 *  `<em>word</em>s` stays intact), stripHtml for whole fetched documents
 *  (script/style/comments dropped, tags become spaces, whitespace collapsed). */

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function htmlToPlain(s: string): string {
  return decodeEntities(String(s ?? '').replace(/<[^>]+>/g, '')).trim();
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s{2,}/g, ' ')
    .trim();
}
