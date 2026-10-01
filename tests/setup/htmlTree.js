// Just enough HTML structure for layout tests: the elements inside <body> as a tree. Script/style/textarea
// contents and comments are skipped; void elements don't nest. Not a real parser, but rendered pages are well formed.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** @returns {{ name, classes, id, children }} the <body> element */
function bodyTree(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let body = null;
  const stack = [];
  let match;
  while ((match = tagRe.exec(cleaned))) {
    const [whole, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (whole.startsWith('</')) {
      if (!body) continue;
      if (name === 'body') break;
      stack.pop();
      continue;
    }
    const node = {
      name,
      classes: ((attrs.match(/\bclass="([^"]*)"/) || [, ''])[1]).split(/\s+/).filter(Boolean),
      id: (attrs.match(/\bid="([^"]*)"/) || [, null])[1],
      children: []
    };
    if (!body) {
      if (name === 'body') { body = node; stack.push(node); }
      continue;
    }
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(name) && !whole.endsWith('/>')) stack.push(node);
  }
  return body;
}

/** Element children of <body>, in order (scripts included) */
function bodyChildren(html) {
  return bodyTree(html).children;
}

module.exports = { bodyTree, bodyChildren };
