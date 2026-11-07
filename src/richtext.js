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

// ── Safe HTML subset ────────────────────────────────────────────────────────
// Creators mix markdown and HTML. Every tag below is rebuilt from scratch:
// only allowlisted tags, attributes and (validated) CSS declarations survive.
// Anything else (<user>, <char>, unknown tags) stays visible as literal text.

const TAG_MAP = {
  div: "div", p: "div", section: "div", article: "div", header: "div", footer: "div",
  main: "div", nav: "div", aside: "div", figure: "div", figcaption: "div", center: "div",
  address: "div", ul: "ul", ol: "ol", li: "li", table: "table", thead: "thead",
  tbody: "tbody", tfoot: "tfoot", tr: "tr", td: "td", th: "th", caption: "caption",
  details: "details", summary: "summary", blockquote: "blockquote",
  span: "span", font: "span", big: "span", abbr: "span", label: "span", q: "span",
  b: "strong", strong: "strong", i: "em", em: "em", cite: "em", u: "u", ins: "u",
  s: "s", strike: "s", del: "s", mark: "mark", small: "small", sub: "sub", sup: "sup",
  a: "a", code: "code", kbd: "code", tt: "code",
};
const BLOCK_OUT = new Set([
  "div", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "caption", "details", "summary", "blockquote",
]);
const AUTO_CLOSE = { li: ["li"], p: ["p"], td: ["td", "th"], th: ["td", "th"], tr: ["tr"] };
const DROP_BLOCKS =
  /<(script|style|iframe|object|embed|svg|video|audio|noscript|template|textarea|select|form|button|canvas|math|head|title)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_VOID = /<(?:link|meta|base|input|source|track|param)\b[^>]*>/gi;
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const TOKEN_RE = /(\d+)/g;
const TOKEN_ONLY = /^(?:\d+\s*)+$/;
const KNOWN_TAG_RE = new RegExp(
  `</?(?:${[...Object.keys(TAG_MAP), "img", "br", "hr", "pre", "h[1-6]"].join("|")})\\b(?:"[^"]*"|'[^']*'|[^'">])*>`,
  "gi",
);

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™", times: "×", middot: "·", bull: "•", hearts: "♥",
};

export function decodeEntities(text) {
  return String(text ?? "").replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi,
    (match, dec, hex, name) => {
      if (name) return Object.hasOwn(NAMED_ENTITIES, name.toLowerCase()) ? NAMED_ENTITIES[name.toLowerCase()] : match;
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      const bad =
        !cp || cp > 0x10ffff || (cp < 32 && cp !== 10 && cp !== 9) ||
        (cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0xe000 && cp <= 0xf8ff);
      return bad ? match : String.fromCodePoint(cp);
    },
  );
}

// ── Colors ──────────────────────────────────────────────────────────────────

const NAMED_COLORS = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080",
  grey: "#808080", silver: "#c0c0c0", gold: "#ffd700", cyan: "#00ffff", aqua: "#00ffff",
  magenta: "#ff00ff", fuchsia: "#ff00ff", violet: "#ee82ee", indigo: "#4b0082",
  crimson: "#dc143c", coral: "#ff7f50", salmon: "#fa8072", lavender: "#e6e6fa",
  lime: "#00ff00", navy: "#000080", maroon: "#800000", teal: "#008080",
  turquoise: "#40e0d0", tomato: "#ff6347", orchid: "#da70d6", plum: "#dda0dd",
  hotpink: "#ff69b4", deeppink: "#ff1493", skyblue: "#87ceeb", lightblue: "#add8e6",
  lightgreen: "#90ee90", darkred: "#8b0000", brown: "#a52a2a", beige: "#f5f5dc",
  ivory: "#fffff0", tan: "#d2b48c", firebrick: "#b22222", goldenrod: "#daa520",
  orangered: "#ff4500", royalblue: "#4169e1", steelblue: "#4682b4", rebeccapurple: "#663399",
};

function parseColor(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = (Object.hasOwn(NAMED_COLORS, v) ? NAMED_COLORS[v] : v).match(
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/,
  );
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = v.match(
    /^rgba?\(\s*(\d{1,3}(?:\.\d+)?%?)[\s,]+(\d{1,3}(?:\.\d+)?%?)[\s,]+(\d{1,3}(?:\.\d+)?%?)(?:[\s,/]+(\d*\.?\d+%?))?\s*\)$/,
  );
  if (!fn) return null;
  const channel = (s) => Math.min(255, Math.round(s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s)));
  const alpha = fn[4] === undefined ? 1 : fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
  return { r: channel(fn[1]), g: channel(fn[2]), b: channel(fn[3]), a: Math.max(0, Math.min(1, alpha)) };
}

function luminance({ r, g, b }) {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const PANEL_LUM = luminance({ r: 23, g: 16, b: 31 });
const cssColor = (c) => `rgba(${c.r},${c.g},${c.b},${Math.round(c.a * 100) / 100})`;

// ── Style declarations ──────────────────────────────────────────────────────

const ENUMS = {
  "text-align": ["left", "right", "center", "justify", "start", "end"],
  "font-style": ["normal", "italic"],
  "text-transform": ["none", "uppercase", "lowercase", "capitalize"],
  display: ["block", "inline", "inline-block", "flex", "inline-flex"],
  "flex-direction": ["row", "column", "row-reverse", "column-reverse"],
  "flex-wrap": ["nowrap", "wrap"],
  "justify-content": ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"],
  "align-items": ["flex-start", "flex-end", "center", "stretch", "baseline"],
  "vertical-align": ["top", "middle", "bottom", "baseline"],
  "font-family": ["monospace", "serif", "sans-serif"],
  "white-space": ["normal", "pre-wrap", "nowrap"],
};
const FONT_KEYWORDS = {
  "x-small": "0.75em", small: "0.875em", medium: "1em", large: "1.2em",
  "x-large": "1.5em", "xx-large": "2em",
};
const FONT_SIZE_ATTR = { 1: "0.75em", 2: "0.9em", 3: "1em", 4: "1.15em", 5: "1.4em", 6: "1.8em", 7: "2.4em" };

function length(value, { px = 1600, em = 12, pct = 100, auto = false } = {}) {
  const v = String(value).trim().toLowerCase();
  if (v === "auto") return auto ? "auto" : "";
  const m = /^(\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(v);
  if (!m) return "";
  const n = parseFloat(m[1]);
  const unit = m[2] || (n === 0 ? "px" : "");
  if (!unit) return "";
  const cap = unit === "px" ? px : unit === "%" ? pct : em;
  return n <= cap ? `${n}${unit}` : "";
}
const lengths = (value, opts, max = 4) => {
  const parts = String(value).trim().split(/\s+/);
  if (parts.length > max) return "";
  const out = parts.map((p) => length(p, opts));
  return out.every(Boolean) ? out.join(" ") : "";
};

function cleanProperty(prop, value) {
  const v = value.toLowerCase();
  if (Object.hasOwn(ENUMS, prop)) return ENUMS[prop].includes(v) ? [[prop, v]] : null;
  switch (prop) {
    case "color": case "background-color": case "background": {
      const c = parseColor(v);
      return c ? [[prop === "color" ? "color" : "background-color", cssColor(c)]] : null;
    }
    case "font-weight":
      return /^(normal|bold|bolder|lighter|[1-9]00)$/.test(v) ? [[prop, v]] : null;
    case "text-decoration": case "text-decoration-line":
      return /^(none|underline|line-through|overline)( (underline|line-through|overline))?$/.test(v)
        ? [["text-decoration", v]] : null;
    case "font-size": {
      if (Object.hasOwn(FONT_KEYWORDS, v)) return [[prop, FONT_KEYWORDS[v]]];
      const m = /^(\d+(?:\.\d+)?)(px|em|rem|%)$/.exec(v);
      if (!m) return null;
      const n = parseFloat(m[1]);
      const ok = m[2] === "px" ? n >= 8 && n <= 48 : m[2] === "%" ? n >= 50 && n <= 300 : n >= 0.5 && n <= 3;
      return ok ? [[prop, v]] : null;
    }
    case "letter-spacing": {
      if (v === "normal") return [[prop, v]];
      const out = length(v, { px: 10, em: 1, pct: 0 });
      return out ? [[prop, out]] : null;
    }
    case "line-height": {
      if (/^\d(\.\d+)?$/.test(v) && parseFloat(v) >= 1 && parseFloat(v) <= 3) return [[prop, v]];
      const out = length(v, { px: 80, em: 3, pct: 300 });
      return out ? [[prop, out]] : null;
    }
    case "width": case "max-width": case "min-width": {
      const out = length(v, { px: 2000, em: 100, pct: 100, auto: prop === "width" });
      return out ? [[prop, out]] : null;
    }
    case "height": {
      const out = length(v, { px: 2000, em: 100, pct: 100, auto: true });
      return out ? [[prop, out]] : null;
    }
    case "margin": case "padding": {
      const out = lengths(v, { px: 200, em: 10, pct: 50, auto: prop === "margin" });
      return out ? [[prop, out]] : null;
    }
    case "margin-top": case "margin-bottom": case "margin-left": case "margin-right":
    case "padding-top": case "padding-bottom": case "padding-left": case "padding-right": {
      const out = length(v, { px: 200, em: 10, pct: 50, auto: prop.startsWith("margin") });
      return out ? [[prop, out]] : null;
    }
    case "gap": case "row-gap": case "column-gap": {
      const out = lengths(v, { px: 100, em: 6, pct: 0 }, 2);
      return out ? [[prop, out]] : null;
    }
    case "border-radius": {
      const out = lengths(v, { px: 999, em: 20, pct: 50 });
      return out ? [[prop, out]] : null;
    }
    case "border": case "border-top": case "border-bottom": case "border-left": case "border-right": {
      const parts = v.replace(/\s*,\s*/g, ",").split(/\s+/);
      let width = "1px", style = "solid", color = "rgba(255,255,255,0.2)";
      for (const part of parts) {
        if (/^(solid|dashed|dotted|double|none)$/.test(part)) style = part;
        else if (/^\d(\.\d+)?(px)?$/.test(part) && parseFloat(part) <= 8) width = `${parseFloat(part)}px`;
        else { const c = parseColor(part); if (!c) return null; color = cssColor(c); }
      }
      return [[prop, style === "none" ? "none" : `${width} ${style} ${color}`]];
    }
    case "opacity":
      return /^(0|1|0?\.\d+)$/.test(v) ? [[prop, v]] : null;
    case "flex":
      return /^(\d{1,2}|auto|none)( \d{1,2})?( (auto|0|\d{1,4}px|\d{1,3}%))?$/.test(v) ? [[prop, v]] : null;
    default:
      return null;
  }
}

function declarationsFrom(styleText) {
  const decls = new Map();
  const clean = String(styleText ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const part of clean.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim().replace(/\s*!important\s*$/i, "").replace(/\s+/g, " ");
    if (!value || /[\\<>{}@&]|url\(|expression|javascript|var\(|attr\(|env\(/i.test(value)) continue;
    for (const [k, val] of cleanProperty(prop, value) || []) decls.set(k, val);
  }
  return decls;
}

// Keeps text readable on our dark panel (or on a light background the author set).
function styleAttribute(decls) {
  const bg = decls.has("background-color") ? parseColor(decls.get("background-color")) : null;
  const solidBg = bg && bg.a >= 0.5 ? bg : null;
  const baseLum = solidBg ? luminance(solidBg) : PANEL_LUM;
  if (decls.has("color")) {
    const text = parseColor(decls.get("color"));
    if (!text || text.a < 0.4 || contrast(luminance(text), baseLum) < 3) decls.delete("color");
  }
  if (solidBg && baseLum > 0.35 && !decls.has("color")) decls.set("color", "#17101f");
  const css = [...decls].map(([k, v]) => `${k}:${v}`).join(";");
  return css ? ` style="${esc(css)}"` : "";
}

// ── Tag rebuilding ──────────────────────────────────────────────────────────

function parseAttrs(raw) {
  const attrs = Object.create(null);
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function applyLegacyAttributes(src, attrs, decls) {
  const set = (prop, value) => {
    if (decls.has(prop)) return;
    for (const [k, v] of cleanProperty(prop, String(value).trim()) || []) decls.set(k, v);
  };
  if (attrs.align) set("text-align", attrs.align.toLowerCase());
  if (attrs.bgcolor) set("background-color", attrs.bgcolor);
  if (src === "center") set("text-align", "center");
  if (src === "big") set("font-size", "1.25em");
  if (src === "font") {
    if (attrs.color) set("color", attrs.color);
    if (/^[1-7]$/.test(attrs.size || "")) decls.has("font-size") || decls.set("font-size", FONT_SIZE_ATTR[attrs.size]);
  }
  if (["table", "td", "th"].includes(src) && attrs.width) {
    set("width", /^\d+$/.test(attrs.width) ? `${attrs.width}px` : attrs.width);
  }
}

function openTag(src, attrs, ctx) {
  let out = TAG_MAP[src];
  const decls = declarationsFrom(attrs.style);
  applyLegacyAttributes(src, attrs, decls);
  let extra = "";
  if (out === "a") {
    const href = safeUrl(attrs.href, ctx.origin);
    if (href) extra = ` href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow"`;
    else out = "span";
  }
  if ((out === "td" || out === "th")) {
    for (const key of ["colspan", "rowspan"]) {
      if (/^\d{1,2}$/.test(attrs[key] || "") && Number(attrs[key]) > 0) extra += ` ${key}="${attrs[key]}"`;
    }
  }
  if (out === "details" && "open" in attrs) extra += " open";
  if (out === "ol" && /^\d{1,4}$/.test(attrs.start || "")) extra += ` start="${attrs.start}"`;
  const html = `<${out}${extra}${styleAttribute(decls)}>`;
  return { out, html: src === "table" ? `<div class="dcv1-rich-table">${html}` : html };
}

const closeTag = (entry) => `</${entry.out}>${entry.src === "table" ? "</div>" : ""}`;

function imageTag(attrs, ctx) {
  const url = safeUrl(attrs.src, ctx.origin);
  if (!url) return "";
  const alt = String(attrs.alt || "").slice(0, 300);
  ctx.images.push({ url, alt });
  const decls = declarationsFrom(attrs.style);
  for (const drop of ["height", "display", "color", "background-color"]) decls.delete(drop);
  if (!decls.has("width") && attrs.width) {
    const w = /^\d+$/.test(attrs.width) ? `${attrs.width}px` : attrs.width;
    for (const [k, v] of cleanProperty("width", w) || []) decls.set(k, v);
  }
  // An explicit width below 100% means the author wants images side by side.
  const w = decls.get("width") || "";
  const m = /^(\d+(?:\.\d+)?)(%|px)$/.exec(w);
  const partial = m && (m[2] === "px" || Number(m[1]) < 100);
  // Leave room for the inline gap so two 50% images really share one row.
  if (partial && m[2] === "%") decls.set("width", `calc(${Number(m[1])}% - 12px)`);
  return `<img class="dcv1-rich-img"${partial ? ' data-sized="true"' : ""} src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-lightbox-src="${esc(url)}"${styleAttribute(decls)}>`;
}

// Replaces allowlisted tags with opaque tokens (and balances them). Tokens are
// resolved to the rebuilt HTML only after all text has been escaped.
function createTagger(ctx) {
  const stack = [];
  const store = (html) => `${ctx.tags.push(html) - 1}`;
  const closeAbove = (index) => {
    const popped = stack.splice(index).reverse();
    return { html: popped.map(closeTag).join(""), block: popped.some((e) => BLOCK_OUT.has(e.out)) };
  };
  const wrap = (html, block) => (block ? `\n${store(html)}\n` : store(html));

  return {
    run(text) {
      return text.replace(TAG_RE, (match, slash, rawName, rawAttrs) => {
        const name = rawName.toLowerCase();
        if (name === "img") {
          if (slash) return "";
          const html = imageTag(parseAttrs(rawAttrs), ctx);
          return html ? store(html) : "";
        }
        if (!Object.hasOwn(TAG_MAP, name)) return match;
        if (slash) {
          const index = stack.map((e) => e.src).lastIndexOf(name);
          if (index < 0) return "";
          const { html, block } = closeAbove(index);
          return wrap(html, block);
        }
        let prefix = "";
        let block = false;
        const top = stack[stack.length - 1];
        if (top && AUTO_CLOSE[name]?.includes(top.src)) {
          const closed = closeAbove(stack.length - 1);
          prefix = closed.html;
          block = closed.block;
        }
        const { out, html } = openTag(name, parseAttrs(rawAttrs), ctx);
        stack.push({ src: name, out });
        return wrap(prefix + html, block || BLOCK_OUT.has(out));
      });
    },
    finish() {
      if (!stack.length) return "";
      const { html } = closeAbove(0);
      return `\n${store(html)}\n`;
    },
  };
}

function prepareSource(source, ctx) {
  let text = String(source ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-]/g, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "").replace(DROP_BLOCKS, "").replace(DROP_VOID, "");
  text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_, inner) =>
    `\n\n\`\`\`\n${decodeEntities(inner.replace(/<\/?[a-zA-Z][^>]*>/g, "")).replace(/```/g, "'''")}\n\`\`\`\n\n`,
  );
  text = text.replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi, (_, level, rawAttrs, inner) => {
    const line = inner.replace(/\s*\n\s*/g, " ").trim();
    if (!line) return "\n\n";
    const md = `\n\n${"#".repeat(Number(level))} ${line}\n\n`;
    return /\b(?:align|style)\s*=/i.test(rawAttrs) ? `\n<div${rawAttrs}>${md}</div>\n` : md;
  });
  text = text.replace(/<br\b[^>]*>/gi, "\n").replace(/<hr\b[^>]*>/gi, "\n\n---\n\n");

  const tagger = createTagger(ctx);
  const parts = text.split(/(```[\s\S]*?```)/g);
  const joined = parts.map((part, i) => (i % 2 ? part : tagger.run(part))).join("") + tagger.finish();
  return joined;
}

function resolveTokens(html, ctx) {
  return html.replace(TOKEN_RE, (_, i) => ctx.tags[Number(i)] ?? "");
}

function renderInline(text, ctx) {
  const stash = [];
  const hold = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let out = esc(decodeEntities(text).replace(/[-]/g, ""));

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
  out = out.replace(/(^|[\s(]|&quot;|&#39;)(https?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<)])+)/g, (_, lead, matched) => {
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
  return resolveTokens(out, ctx);
}

/**
 * Render creator text (markdown plus a safe HTML subset) to HTML.
 * Returns { html, images, plain } where images are every image found.
 */
export function renderRichText(source, { origin = "https://datacat.run" } = {}) {
  const ctx = { origin, images: [], tags: [] };
  const lines = prepareSource(source, ctx).split("\n");
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
    if (TOKEN_ONLY.test(line.trim())) {
      flushAll();
      html.push(resolveTokens(line.trim(), ctx));
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
    html: resolveTokens(html.join(""), ctx),
    images,
    plain: decodeEntities(String(source ?? "").replace(KNOWN_TAG_RE, " ")).replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim(),
  };
}

// Datacat appends "[retrieved by https://datacat.run on …]" to exports.
// Point that link at this character's own page.
export function retargetRetrievedBy(text, url) {
  if (!url || typeof text !== "string") return text;
  return text.replace(/(\[retrieved by\s+)https?:\/\/(?:www\.)?datacat\.run\/?(?=\s+on\b)/i, (_, lead) => `${lead}${url}`);
}

export function botPageUrl(character, origin = "https://datacat.run") {
  const id = String(character?.id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return "";
  for (const key of ["url", "webUrl", "pageUrl", "profileUrl", "permalink"]) {
    const raw = character?.[key];
    if (typeof raw !== "string") continue;
    try {
      const url = new URL(raw, origin);
      if (url.origin === origin && url.pathname.toLowerCase().includes(id)) return url.href;
    } catch (_) {}
  }
  return `${origin}/characters/${id}`;
}

// Plain one-paragraph preview for cards and lists (no markup, no images).
export function snippetText(source, maxLength = 400) {
  const text = decodeEntities(
    String(source ?? "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(DROP_BLOCKS, " ")
      .replace(/<br\b[^>]*>/gi, " ")
      .replace(KNOWN_TAG_RE, " "),
  )
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

// Order matters: the first tab with content is the default view.
const CARD_TEXT_TABS = [
  ["notes", "Creator Notes", ["creator_notes", "creatorNotes", "creatorcomment"]],
  ["description", "Description", ["description"]],
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
export function cardTabs(card, { origin = "https://datacat.run", fallbackDescription = "", botUrl = "" } = {}) {
  const tabs = [];
  const fix = (text) => retargetRetrievedBy(text, botUrl);
  const add = (id, label, source, count) => {
    const rendered = renderRichText(source, { origin });
    if (!rendered.html) return;
    tabs.push({ id, label, count, ...rendered });
  };
  for (const [id, label, keys] of CARD_TEXT_TABS) {
    let source = cardField(card, keys);
    if (!source && id === "description") source = fallbackDescription;
    if (source) add(id, label, fix(source));
  }
  const alts = [card?.data?.alternate_greetings, card?.alternate_greetings, card?.alternateGreetings]
    .find((list) => Array.isArray(list));
  const greetings = (alts || []).filter((text) => typeof text === "string" && text.trim());
  if (greetings.length) {
    const rendered = greetings.map((text) => renderRichText(fix(text), { origin }));
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
