// Just enough HTML structure for layout tests: which elements are direct children
// of <body>, in order. Script/style contents and comments are skipped; void
// elements don't open a level. Not a real parser, but rendered pages are well formed.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function bodyChildren(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  const children = [];
  let depth = null; // depth below <body>; null until <body> opens
  let match;
  while ((match = tagRe.exec(cleaned))) {
    const [whole, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    const closing = whole.startsWith('</');
    if (depth === null) {
      if (!closing && name === 'body') depth = 0;
      continue;
    }
    if (closing) {
      if (name === 'body' && depth === 0) break;
      depth -= 1;
      continue;
    }
    if (depth === 0) {
      const cls = (attrs.match(/\bclass="([^"]*)"/) || [, ''])[1];
      children.push({ name, classes: cls.split(/\s+/).filter(Boolean) });
    }
    if (!VOID.has(name) && !whole.endsWith('/>')) depth += 1;
  }
  return children;
}

module.exports = { bodyChildren };
