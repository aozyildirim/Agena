/**
 * Lightweight markdown → safe HTML converter for NR/Sentry/Agena-generated
 * task descriptions. Handles: H2/H3/H4, **bold**, *italic*, `inline code`,
 * ```fenced code```, tables, bullet lists, [links](url), bare URLs.
 *
 * Input is fully HTML-escaped before formatting, so raw HTML in the source
 * never reaches the DOM — safe for dangerouslySetInnerHTML.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  let text = src.replace(/\r\n?/g, '\n');

  // Stash fenced code blocks first (so their contents aren't touched)
  const codeBlocks: string[] = [];
  text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, _lang, body) => {
    codeBlocks.push(
      `<pre class="md-code"><code>${escapeHtml(body)}</code></pre>`,
    );
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // Stash inline code spans
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_m, body) => {
    inlineCodes.push(`<code class="md-inline">${escapeHtml(body)}</code>`);
    return `\x00INL${inlineCodes.length - 1}\x00`;
  });

  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();

    if (!stripped) {
      out.push('');
      i += 1;
      continue;
    }

    // Heading
    const hMatch = stripped.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      const level = Math.min(hMatch[1].length, 6);
      out.push(`<h${level} class="md-h">${inlineTransform(hMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Table (pipe-delimited)
    if (stripped.startsWith('|') && stripped.includes('|')) {
      const rows: string[][] = [];
      while (i < lines.length) {
        const row = lines[i].trim();
        if (!row.startsWith('|') || !row.includes('|')) break;
        if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(row)) {
          i += 1;
          continue;
        }
        rows.push(row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i += 1;
      }
      if (rows.length) {
        const [head, ...body] = rows;
        const th = head
          .map((c) => `<th>${inlineTransform(c)}</th>`)
          .join('');
        const trs = body
          .map(
            (r) =>
              '<tr>' +
              r.map((c) => `<td>${inlineTransform(c)}</td>`).join('') +
              '</tr>',
          )
          .join('');
        out.push(
          `<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`,
        );
        continue;
      }
    }

    // Bullet list
    if (/^[-*+]\s+/.test(stripped)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      const lis = items.map((it) => `<li>${inlineTransform(it)}</li>`).join('');
      out.push(`<ul class="md-list">${lis}</ul>`);
      continue;
    }

    // Paragraph
    out.push(`<p class="md-p">${inlineTransform(stripped)}</p>`);
    i += 1;
  }

  let html = out.filter((s) => s !== '').join('\n');

  // Restore code blocks / inline spans
  codeBlocks.forEach((block, idx) => {
    html = html.split(`\x00CODE${idx}\x00`).join(block);
  });
  inlineCodes.forEach((span, idx) => {
    html = html.split(`\x00INL${idx}\x00`).join(span);
  });

  return html;
}

function inlineTransform(text: string): string {
  // Protect already-stashed placeholders so escape doesn't mangle them
  const saved: string[] = [];
  let t = text.replace(/\x00(?:CODE|INL)\d+\x00/g, (m) => {
    saved.push(m);
    return `\x00PH${saved.length - 1}\x00`;
  });
  t = escapeHtml(t);
  saved.forEach((s, i) => {
    t = t.split(`\x00PH${i}\x00`).join(s);
  });

  // [label](url)
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) =>
      `<a href="${url}" target="_blank" rel="noreferrer" class="md-link">${label}</a>`,
  );
  // Bold **text**
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (avoid remnants of bold)
  t = t.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em>$1</em>');
  // Bare URL auto-link (not inside attribute already)
  t = t.replace(
    /(?<!["'>])((?:https?):\/\/[^\s<)]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer" class="md-link">$1</a>',
  );
  return t;
}
