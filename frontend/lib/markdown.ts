/**
 * Lightweight markdown → safe HTML converter for NR/Sentry/Agena-generated
 * task descriptions. Handles: H2/H3/H4, **bold**, *italic*, `inline code`,
 * ```fenced code```, tables, bullet lists, [links](url), bare URLs.
 *
 * Markdown input is fully HTML-escaped before formatting so raw HTML in
 * the source never reaches the DOM. If the input already IS HTML (e.g.
 * Azure DevOps work-item descriptions), it is sanitized instead of
 * escaped — structural tags come through, but inline style/class,
 * event handlers, script/iframe blocks and javascript: URLs are stripped.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Loose detection: does this string look like it was authored as HTML?
// Azure DevOps / Jira rich-text fields ship wrapped in <div>, <p>, <span>,
// headings, lists, tables, etc. A single matching opening tag is enough
// to flip into HTML mode.
function looksLikeHtml(src: string): boolean {
  return /<(?:p|div|span|br|ul|ol|li|h[1-6]|strong|em|b|i|u|code|pre|blockquote|table|thead|tbody|tr|td|th|a|img|hr)\b[^>]*>/i.test(src);
}

// Regex-based HTML sanitizer. We deliberately avoid DOMParser so this
// stays safe under SSR. Everything dangerous is stripped; visible
// structure stays.
function sanitizeHtml(html: string): string {
  let s = html;
  // Drop entire <script>/<style>/<iframe>/… blocks including their contents.
  s = s.replace(/<(script|style|iframe|object|embed|form|input|textarea|select|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, '');
  // Drop self-closing / void variants of the same dangerous tags.
  s = s.replace(/<(script|style|iframe|object|embed|form|input|textarea|select|link|meta|base)\b[^>]*\/?\s*>/gi, '');
  // Strip on* event handler attributes (onclick, onerror, onload, …).
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  // Strip inline style="…" — ADO ships Teams-dark backgrounds / Segoe UI
  // font stacks that clash with our theme. Dropping them lets the parent
  // .task-md class own the typography.
  s = s.replace(/\sstyle\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\sstyle\s*=\s*'[^']*'/gi, '');
  // Strip class="…" — ADO uses its own utility classes that we don't ship.
  s = s.replace(/\sclass\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\sclass\s*=\s*'[^']*'/gi, '');
  // Neutralize javascript: / vbscript: / data: URIs in href/src.
  s = s.replace(/\s(href|src)\s*=\s*"\s*(?:javascript|vbscript|data):[^"]*"/gi, ' $1="#"');
  s = s.replace(/\s(href|src)\s*=\s*'\s*(?:javascript|vbscript|data):[^']*'/gi, " $1='#'");
  // Azure DevOps attachment images need a PAT to load — the browser
  // can't reach them, so they render as a broken-image icon. Replace
  // those <img> tags with a small inline notice so the description
  // preview stays clean. The actual image bytes are still pulled at
  // task-run time by the orchestration layer's image prefetch.
  s = s.replace(
    /<img\b[^>]*\bsrc=["'][^"']*(?:dev\.azure\.com|\/_apis\/wit\/attachments\/)[^"']*["'][^>]*>/gi,
    '<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border-radius:4px;background:rgba(96,165,250,0.12);color:#60a5fa;font-size:11px;font-weight:600">📷 image</span>',
  );
  // Force anchors to open externally.
  s = s.replace(/<a\b([^>]*)>/gi, (_m, attrs) => {
    const hasTarget = /\btarget\s*=/.test(attrs);
    const hasRel = /\brel\s*=/.test(attrs);
    return `<a${attrs}${hasTarget ? '' : ' target="_blank"'}${hasRel ? '' : ' rel="noreferrer"'} class="md-link">`;
  });
  // The backend sometimes appends plain-text metadata lines after the HTML
  // body (e.g. "\n\n---\nRemote Repo: foo"). Preserve those line breaks
  // outside of tags so they render instead of collapsing into one line.
  s = s.replace(/>([^<]+)</g, (_m, between: string) => {
    return '>' + between.replace(/\n/g, '<br>') + '<';
  });
  // Handle a trailing plain-text tail after the last closing tag too.
  const lastClose = s.lastIndexOf('>');
  if (lastClose !== -1 && lastClose < s.length - 1) {
    const tail = s.slice(lastClose + 1).replace(/\n/g, '<br>');
    s = s.slice(0, lastClose + 1) + tail;
  }
  return s;
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  if (looksLikeHtml(src)) return sanitizeHtml(src);
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
