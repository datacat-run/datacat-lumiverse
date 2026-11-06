// Safe, dependency-free renderer for character descriptions (markdown plus the
// small HTML subset creators commonly paste), and lorebook helpers.
// Everything is escaped first; only the tags emitted below can reach the DOM.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function safeUrl(value, origin = "https://datacat.run") {
  const raw = String(value || "").trim().replace(/&amp;/g, "&");
  if (!raw || /^(javascript|data|vbscript):/i.test(raw)) return "";
  try {
    const url = new URL(raw, origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

// Tags creators use for layout. Anything else (<user>, <char>, ...) stays
// visible as literal text because card text often uses those as placeholders.
const LAYOUT_TAGS =
  "div|span|p|center|font|section|article|header|footer|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|details|summary|small|big|u|s|strike|del|ins|sub|sup|mark|style|script|iframe|video|audio|source|svg|figure|figcaption|h[1-6]|pre|code|blockquote|label|button|form|input";

function normalizeHtml(source) {
  let text = String(source ?? "").replace(/\r\n?/g, "\n");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<(script|style|iframe|svg|video|audio)\b[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!src) return "";
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    return `\n![${(alt?.[1] ?? alt?.[2] ?? "").replace(/[\[\]]/g, "")}](${(src[1] ?? src[2] ?? src[3]).trim()})\n`;
  });
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  text = text.replace(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
    (_, a, b, inner) => `[${inner.replace(/<[^>]+>/g, "").trim() || a || b}](${a ?? b})`,
  );
  text = text.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  text = text.replace(/<\/(p|div|section|article|header|footer|tr|li|h[1-6]|figure|details)>/gi, "\n\n");
  text = text.replace(new RegExp(`</?(?:${LAYOUT_TAGS})\\b[^>]*>`, "gi"), "");
  return text;
}

function renderInline(text, ctx) {
  const stash = [];
  const hold = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let out = esc(text);

  out = out.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, alt, href) => {
    const url = safeUrl(href, ctx.origin);
    if (!url) return "";
    ctx.images.push({ url, alt: alt.trim() });
    return hold(
      `<img class="dcv1-rich-img" src="${esc(url)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-lightbox-src="${esc(url)}">`,
    );
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, label, href) => {
    const url = safeUrl(href, ctx.origin);
    return url
      ? hold(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`)
      : label;
  });
  out = out.replace(/(^|[\s(]|&quot;|&#39;)(https?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<)])+)/g, (_, lead, matched) => {
    const href = matched.replace(/[.,;:!?]+$/, "");
    const tail = matched.slice(href.length);
    const url = safeUrl(href, ctx.origin);
    return url
      ? `${lead}${hold(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${href}</a>`)}${tail}`
      : `${lead}${matched}`;
  });
  out = out
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])__([^_\n]+)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w_])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  let guard = 0;
  while (/\u0000\d+\u0000/.test(out) && guard++ < 5) {
    out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? "");
  }
  return out;
}

/**
 * Render creator text to safe HTML.
 * Returns { html, images, plain } where images are every inline image found.
 */
export function renderRichText(source, { origin = "https://datacat.run" } = {}) {
  const ctx = { origin, images: [] };
  const lines = normalizeHtml(source).split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  let fence = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map((line) => renderInline(line, ctx)).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(
      `<${list.tag}>${list.items.map((item) => `<li>${renderInline(item, ctx)}</li>`).join("")}</${list.tag}>`,
    );
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${quote.map((line) => renderInline(line, ctx)).join("<br>")}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (fence) {
      if (/^```/.test(line.trim())) {
        html.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        fence.push(rawLine);
      }
      continue;
    }
    if (/^```/.test(line.trim())) {
      flushAll();
      fence = [];
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(6, heading[1].length + 1);
      html.push(`<h${level}>${renderInline(heading[2], ctx)}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      html.push("<hr>");
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ||= { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  if (fence) html.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  flushAll();

  const seen = new Set();
  const images = ctx.images.filter((image) => !seen.has(image.url) && seen.add(image.url));
  return {
    html: html.join(""),
    images,
    plain: normalizeHtml(source).replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim(),
  };
}

// Plain one-paragraph preview for cards and lists (no markup, no images).
export function snippetText(source, maxLength = 400) {
  const text = normalizeHtml(source)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_]+(?=\S)|(?<=\S)[*_]+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

// Collect gallery-like image URLs from whichever shape the API provides.
export function collectGalleryImages(character, origin = "https://datacat.run") {
  const sources = [
    character?.images,
    character?.gallery,
    character?.galleryImages,
    character?.gallery_images,
    character?.media,
    character?.screenshots,
  ];
  const found = [];
  for (const group of sources) {
    const items = Array.isArray(group) ? group : Array.isArray(group?.items) ? group.items : [];
    for (const item of items) {
      const raw =
        typeof item === "string"
          ? item
          : item?.url || item?.src || item?.imageUrl || item?.image?.url || "";
      const url = safeUrl(raw, origin);
      if (!url) continue;
      if (item?.status && String(item.status).toLowerCase() !== "ready") continue;
      found.push({
        url,
        alt: typeof item === "object" ? String(item?.caption || item?.alt || "") : "",
      });
    }
  }
  const seen = new Set();
  return found.filter((image) => !seen.has(image.url) && seen.add(image.url));
}

// ── Lorebook helpers ────────────────────────────────────────────────────────

export function findCharacterBook(card) {
  const source = card && typeof card === "object" ? card : {};
  const candidates = [
    source.data?.character_book,
    source.extensions?.character_book,
    source.data?.extensions?.character_book,
    source.character_book,
    source.characterBook,
  ];
  return candidates.find((book) => book && typeof book === "object") || null;
}

export function lorebookEntryCount(book) {
  const entries = Array.isArray(book?.entries)
    ? book.entries
    : book?.entries && typeof book.entries === "object"
      ? Object.values(book.entries)
      : [];
  return entries.filter(
    (entry) => entry && String(entry.content ?? entry.text ?? "").trim(),
  ).length;
}

// Flat (non-spec) cards must carry the book under extensions for Lumiverse.
export function ensureBookInExtensions(card) {
  if (!card || typeof card !== "object") return card;
  const book = findCharacterBook(card);
  if (!book) return card;
  if (card.spec && card.data) return card;
  if (card.extensions?.character_book) return card;
  card.extensions = {
    ...(card.extensions && typeof card.extensions === "object" ? card.extensions : {}),
    character_book: book,
  };
  return card;
}

// What the public profile says about a lorebook, if anything.
export function profileLorebookInfo(character) {
  const entryCount = Number(
    character?.lorebookEntryCount ??
      character?.lorebookEntries ??
      character?.stats?.lorebookEntries ??
      character?.lorebook?.entryCount ??
      character?.lorebook?.entries?.length ??
      character?.characterBook?.entries?.length ??
      0,
  );
  const flag =
    character?.hasLorebook === true ||
    character?.has_lorebook === true ||
    Boolean(character?.lorebook) ||
    Boolean(character?.characterBook);
  const tagged = [...(character?.tags || []), ...(character?.customTags || [])]
    .map((tag) => String(typeof tag === "string" ? tag : tag?.name || tag?.label || "").toLowerCase())
    .some((tag) => /lore\s*-?book|world\s*-?(book|info)/.test(tag));
  const count = Number.isFinite(entryCount) && entryCount > 0 ? entryCount : 0;
  return { has: flag || tagged || count > 0, count };
}

// ── Full card preview ───────────────────────────────────────────────────────

const CARD_TEXT_TABS = [
  ["description", "Description", ["description"]],
  ["notes", "Creator Notes", ["creator_notes", "creatorNotes"]],
  ["greeting", "Greeting", ["first_mes", "firstMes", "first_message"]],
  ["scenario", "Scenario", ["scenario"]],
  ["example", "Example Dialogue", ["mes_example", "mesExample", "example_dialogue"]],
];

function cardField(card, keys) {
  for (const holder of [card?.data, card]) {
    if (!holder || typeof holder !== "object") continue;
    for (const key of keys) {
      const value = holder[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "";
}

/**
 * Turn a character card (V2 spec or flat) into display tabs.
 * Only non-empty fields get a tab. `fallbackDescription` fills the
 * Description tab when the card itself has none.
 */
export function cardTabs(card, { origin = "https://datacat.run", fallbackDescription = "" } = {}) {
  const tabs = [];
  const add = (id, label, source, count) => {
    const rendered = renderRichText(source, { origin });
    if (!rendered.html) return;
    tabs.push({ id, label, count, ...rendered });
  };
  for (const [id, label, keys] of CARD_TEXT_TABS) {
    let source = cardField(card, keys);
    if (!source && id === "description") source = fallbackDescription;
    if (source) add(id, label, source);
  }
  const alts = [card?.data?.alternate_greetings, card?.alternate_greetings, card?.alternateGreetings]
    .find((list) => Array.isArray(list));
  const greetings = (alts || []).filter((text) => typeof text === "string" && text.trim());
  if (greetings.length) {
    const rendered = greetings.map((text) => renderRichText(text, { origin }));
    const html = rendered
      .map((item, index) => `<div class="dcv1-alt-greeting"><h3>Greeting ${index + 2}</h3>${item.html}</div>`)
      .join("");
    const seen = new Set();
    const images = rendered
      .flatMap((item) => item.images)
      .filter((image) => !seen.has(image.url) && seen.add(image.url));
    tabs.push({
      id: "alts",
      label: "Alt Greetings",
      count: greetings.length,
      html,
      images,
      plain: rendered.map((item) => item.plain).join("\n\n"),
    });
  }
  return tabs;
}
