import { uuidv7 } from "./uuidv7.js";
import {
  botPageUrl,
  cardTabs,
  collectGalleryImages,
  ensureBookInExtensions,
  findCharacterBook,
  lorebookEntryCount,
  profileLorebookInfo,
  renderRichText,
  retargetRetrievedBy,
  snippetText,
} from "./richtext.js";

const VERSION = "0.5.48";
const DISPLAY_VERSION = "0.1";
const PAGE_SIZE = 24;
const CHAT_LOADING_MIN_MS = 750;
const MAX_MIRRORED_AVATAR_BYTES = 50 * 1024 * 1024;
const CATALOG_SORT_OPTIONS = Object.freeze([
  { value: "first_published", label: "Latest" },
  { value: "score", label: "Highly Rated" },
  { value: "chat_count", label: "Chat Count" },
  { value: "messages_per_chat", label: "Msg/Chat" },
]);
const PROD_ORIGIN = "https://datacat.run";
const API_PATH = "/api/client/v1";
const VERIFICATION_ACTION = "character-import";
const STORAGE_PREFIX = "datacat_client_v1";
const BROWSER_STATE_KEY = `${STORAGE_PREFIX}:browser_state`;
let datacatBackendRequest = null;
let verificationLeaseState = null;

const CAT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5.2 8.3 7 3.9l4.1 2.2c.6-.1 1.2-.1 1.8 0L17 3.9l1.8 4.4c1.3 1.4 2 3.2 2 5.1 0 4.3-3.9 7.6-8.8 7.6s-8.8-3.3-8.8-7.6c0-1.9.7-3.7 2-5.1Z" fill="currentColor"/>
    <circle cx="8.6" cy="12.2" r="1.15" fill="#17101f"/>
    <circle cx="15.4" cy="12.2" r="1.15" fill="#17101f"/>
    <path d="M9.4 16c1.7 1 3.5 1 5.2 0" fill="none" stroke="#17101f" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;

const KUDOS_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.8 5.8a5.2 5.2 0 0 0-7.4 0L12 7.2l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 22l8.8-8.8a5.2 5.2 0 0 0 0-7.4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const COMMENT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const REFRESH_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.3 5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const ACCOUNT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M5 20c.6-3.6 3.2-5.5 7-5.5s6.4 1.9 7 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
`;

const SORT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h10M4 12h7M4 17h4M17 5v14M17 19l-4-4M17 19l4-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function renderLoadingState(label) {
  return `
    <div class="dcv1-empty dcv1-loading-state" role="status" aria-live="polite">
      <span class="dcv1-loader-visual" aria-hidden="true">${CAT_ICON}</span>
      <span class="dcv1-loader-copy">${escapeHtml(label)}</span>
    </div>`;
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}m`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(number);
}

function scorePresentation(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return { label: "—", tier: "none", detail: "Not scored" };
  }
  const rounded = Math.round(score);
  return {
    label: `${rounded}%`,
    tier: score >= 95 ? "top" : score >= 60 ? "mid" : "low",
    detail:
      score >= 95
        ? "Exceptional"
        : score >= 60
          ? "Established"
          : "Developing",
  };
}

function readableDate(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function compactDateBadge(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function relativeTime(value, now = Date.now()) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  const weeks = Math.floor(seconds / 604800);
  if (weeks < 5) return `${weeks}w ago`;
  return readableDate(value);
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCatalogSort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CATALOG_SORT_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "first_published";
}

function catalogSortOption(value) {
  const normalized = normalizeCatalogSort(value);
  return (
    CATALOG_SORT_OPTIONS.find((option) => option.value === normalized) ||
    CATALOG_SORT_OPTIONS[0]
  );
}

function catalogSortBadge(value) {
  const normalized = normalizeCatalogSort(value);
  if (normalized === "score") return "Rated";
  if (normalized === "chat_count") return "Chats";
  if (normalized === "messages_per_chat") return "Msgs";
  return "Latest";
}

function apiOrigin() {
  return PROD_ORIGIN;
}

function storageKey(name) {
  return `${STORAGE_PREFIX}:${name}`;
}

function loadTagViewMode() {
  try {
    return localStorage.getItem(storageKey("tag_view")) === "list"
      ? "list"
      : "cloud";
  } catch (_) {
    return "cloud";
  }
}

function saveTagViewMode(mode) {
  try {
    localStorage.setItem(
      storageKey("tag_view"),
      mode === "list" ? "list" : "cloud",
    );
  } catch (_) {}
}

function getVerificationLease() {
  const expiresAt = Date.parse(String(verificationLeaseState?.expiresAt || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 5000) {
    verificationLeaseState = null;
    return null;
  }
  return { expiresAt };
}

function setVerificationLease(value) {
  const expiresAt = Date.parse(String(value?.expiresAt || ""));
  verificationLeaseState = Number.isFinite(expiresAt)
    ? { expiresAt: new Date(expiresAt).toISOString() }
    : null;
  if (!verificationLeaseState && datacatBackendRequest) {
    void datacatBackendRequest("clear-verification").catch(() => {});
  }
}

function backendResponse(result = {}) {
  const headers = result.headers && typeof result.headers === "object"
    ? result.headers
    : {};
  return {
    ok: Number(result.status) >= 200 && Number(result.status) < 300,
    status: Number(result.status || 500),
    headers: {
      get(name) {
        const wanted = String(name || "").toLowerCase();
        const entry = Object.entries(headers).find(
          ([key]) => String(key).toLowerCase() === wanted,
        );
        return entry ? String(entry[1] || "") : null;
      },
    },
    async json() {
      try {
        return JSON.parse(String(result.body || "{}"));
      } catch (_) {
        return {};
      }
    },
  };
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const error = new Error(
      publicRequestErrorMessage(payload?.error, response.status),
    );
    error.code = payload?.error || "DATACAT_REQUEST_FAILED";
    error.status = response.status;
    error.verificationRequired =
      payload?.verificationRequired === true ||
      payload?.securityCheckRequired === true ||
      error.code === "CLIENT_VERIFICATION_REQUIRED";
    const retry = response.headers.get("Retry-After");
    if (retry) error.retryAfter = retry;
    throw error;
  }
  return payload;
}

function publicRequestErrorMessage(
  code,
  status,
  fallback = "Datacat could not complete that request.",
) {
  if (code === "CLIENT_VERIFICATION_REQUIRED") {
    return "Complete the Datacat security check to continue.";
  }
  if (Number(status) === 429) return "Datacat is busy. Please try again shortly.";
  if (Number(status) === 404) return "That Datacat item is no longer available.";
  return fallback;
}

function publicErrorMessage(error, fallback) {
  return publicRequestErrorMessage(error?.code, error?.status, fallback);
}

async function datacatFetch(path, options = {}) {
  if (!datacatBackendRequest) {
    throw new Error("The secure Lumiverse Datacat bridge is not ready.");
  }
  const result = await datacatBackendRequest("api", {
    path,
    method: options.method || "GET",
    body: options.body || "",
  });
  const response = backendResponse(result);
  return readJson(response);
}

function characterCreator(character) {
  return String(character?.creator?.name || character?.creatorName || "Unknown creator");
}

function characterCreatorRef(character) {
  const explicit = String(character?.creator?.ref || "").trim().toLowerCase();
  if (explicit) return explicit;
  return normalizeId(character?.creator?.id || character?.creatorId);
}

function characterStats(character) {
  const stats = character?.stats && typeof character.stats === "object"
    ? character.stats
    : {};
  return {
    chats: compactNumber(stats.chats),
    messages: compactNumber(stats.messages),
    messagesPerChat:
      Number.isFinite(Number(stats.messagesPerChat))
        ? Number(stats.messagesPerChat)
        : null,
    tokens: compactNumber(character?.totalTokens),
  };
}

function characterTags(character) {
  return [...(character?.tags || []), ...(character?.customTags || [])]
    .map((tag) => typeof tag === "string" ? tag : tag?.name || tag?.label || "")
    .filter(Boolean);
}

function advertisedImageUrl(character) {
  if (
    character?.image?.status &&
    String(character.image.status).trim().toLowerCase() !== "ready"
  ) {
    return "";
  }
  try {
    const url = new URL(
      String(character?.image?.url || character?.avatarUrl || "").trim(),
      apiOrigin(),
    );
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch (_) {
    return "";
  }
}

function characterClientPath(character, action) {
  const characterId = normalizeId(character?.id);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      characterId,
    )
  ) {
    return "";
  }
  const expectedPrefix = `/characters/${characterId}`;
  const expectedSuffix = {
    profile: "",
    card: "/card",
    avatar: "/avatar",
    avatarPreview: "/avatar-preview",
  }[action];
  if (expectedSuffix === undefined) return "";
  const advertised = String(character?.clientPaths?.[action] || "").trim();
  if (advertised) {
    try {
      const url = new URL(`${API_PATH}${advertised}`, apiOrigin());
      if (
        url.origin === apiOrigin() &&
        url.pathname === `${API_PATH}${expectedPrefix}${expectedSuffix}`
      ) {
        return `${url.pathname.slice(API_PATH.length)}${url.search}`;
      }
    } catch (_) {}
  }
  return "";
}

async function resolveImportTransferContract(character, characterId) {
  const normalizedId = normalizeId(character?.id || characterId);
  if (!normalizedId) {
    throw new Error("This character has no valid Datacat id for import.");
  }
  let current = { ...(character || {}), id: normalizedId };
  let cardPath = characterClientPath(current, "card");
  let avatarPath = characterClientPath(current, "avatar");
  if (!cardPath || !avatarPath || !advertisedImageUrl(current)) {
    const payload = await datacatFetch(
      `/characters/${encodeURIComponent(normalizedId)}`,
    );
    current = {
      ...current,
      ...(payload.character || {}),
      id: normalizeId(payload.character?.id) || normalizedId,
    };
    cardPath = characterClientPath(current, "card");
    avatarPath = characterClientPath(current, "avatar");
  }
  if (!cardPath || !avatarPath) {
    throw new Error(
      "Datacat did not advertise valid card and image transfer paths for this character.",
    );
  }
  return { character: current, cardPath, avatarPath };
}

function displayAvatarUrl(character) {
  return advertisedImageUrl(character);
}

function extensionForImageType(contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/avif") return "avif";
  return "webp";
}

async function downloadMirroredAvatar(
  character,
  avatarPath = characterClientPath(character, "avatar"),
) {
  if (!advertisedImageUrl(character)) {
    throw new Error(
      "This character’s Datacat-mirrored image is not ready yet. No source-site image was used.",
    );
  }
  const characterId = String(character?.id || "").trim();
  if (!characterId) {
    throw new Error("This character has no Datacat id for its mirrored image.");
  }
  if (!avatarPath) {
    throw new Error("This character has no valid Datacat image path.");
  }
  const result = await datacatBackendRequest("api", {
    path: avatarPath,
    method: "GET",
    responseType: "arraybuffer",
  });
  const response = backendResponse(result);
  if (!response.ok) {
    const payload = await response.json();
    const error = new Error(
      publicRequestErrorMessage(
        payload?.error,
        response.status,
        "Could not load this character image.",
      ),
    );
    error.code = payload?.error || "DATACAT_AVATAR_FAILED";
    error.status = response.status;
    error.verificationRequired =
      payload?.verificationRequired === true ||
      payload?.securityCheckRequired === true ||
      error.code === "CLIENT_VERIFICATION_REQUIRED";
    const retry = response.headers.get("Retry-After");
    if (retry) error.retryAfter = retry;
    throw error;
  }
  const contentType = String(response.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("Datacat’s mirrored image response was not an image.");
  }
  let bytes;
  if (result.body instanceof Uint8Array) {
    bytes = result.body;
  } else {
    const binary = atob(String(result.body || ""));
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  }
  const blob = new Blob([bytes], { type: contentType });
  if (!blob.size || blob.size > MAX_MIRRORED_AVATAR_BYTES) {
    throw new Error("Datacat’s mirrored image was empty or too large for Lumiverse.");
  }
  const safeName = String(character?.name || "character")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "character";
  return new File(
    [blob],
    `${safeName}.${extensionForImageType(contentType || blob.type)}`,
    { type: contentType || blob.type || "image/webp" },
  );
}

export function setup(ctx) {
  const tab = ctx.ui.registerDrawerTab({
    id: "datacat-client-v1",
    title: "Datacat",
    shortName: "Datacat",
    headerTitle: "Datacat",
    description: "Browse and import Datacat characters.",
    keywords: ["datacat", "characters", "browse", "import"],
    iconSvg: CAT_ICON,
  });

  const removeStyle = ctx.dom.addStyle(`
    .dcv1-drawer-root {
      width: 100%;
      height: 100%;
      min-height: 0;
      display: flex;
      overflow: hidden;
    }
    .dcv1-host {
      position: absolute !important;
      inset: 0 !important;
      width: auto !important;
      height: auto !important;
      min-height: 0 !important;
      display: flex !important;
      overflow: hidden !important;
    }
    .dcv1-lumiverse-panel-header {
      display: none !important;
    }
    .dcv1-lumiverse-panel-content {
      padding: 0 !important;
      overflow: hidden !important;
    }
    .dcv1-root,
    .dcv1-root *,
    .dcv1-page-modal-host,
    .dcv1-page-modal-host * { box-sizing: border-box; }
    .dcv1-root,
    .dcv1-page-modal-host {
      --dc-bg: #100c17;
      --dc-panel: #191221;
      --dc-panel-2: #21172c;
      --dc-border: rgba(246, 200, 76, .2);
      --dc-text: #fff8e8;
      --dc-muted: #b9adbf;
      --dc-yellow: #f6c84c;
      --dc-purple: #9c6bd2;
      color: var(--dc-text);
      font: inherit;
    }
    .dcv1-root {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(circle at 85% -20%, rgba(116, 63, 164, .34), transparent 42%),
        var(--dc-bg);
    }
    .dcv1-page-modal-host {
      position: fixed;
      inset: 0;
      z-index: 2147482000;
      pointer-events: none;
    }
    .dcv1-page-modal-host[data-open="true"] {
      pointer-events: auto;
    }
    body.dcv1-character-modal-open {
      overflow: hidden !important;
    }
    .dcv1-toolbar {
      position: relative;
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 4px;
      padding: 7px 8px 6px;
      border-bottom: 1px solid var(--dc-border);
      background: rgba(16, 12, 23, .92);
    }
    .dcv1-toolbar-copy {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .dcv1-toolbar-brand {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      color: var(--dc-yellow);
      font-size: 15px;
      font-weight: 500;
      line-height: 1;
    }
    .dcv1-version-badge {
      flex: 0 0 auto;
      padding: 2px 5px;
      color: #211509;
      border: 1px solid var(--dc-yellow);
      border-radius: 999px;
      background: var(--dc-yellow);
      font-size: 8px;
      font-weight: 400;
      line-height: 1;
    }
    .dcv1-toolbar-icon {
      width: 30px;
      min-height: 30px;
      margin: 0;
      padding: 0;
      display: inline-grid;
      place-items: center;
    }
    .dcv1-toolbar-icon svg {
      width: 24px;
      height: 24px;
    }
    .dcv1-toolbar-bare {
      color: var(--dc-muted);
      border: 0;
      border-radius: 0;
      background: transparent;
    }
    .dcv1-toolbar-bare:hover:not(:disabled) {
      color: var(--dc-yellow);
      border: 0;
      background: transparent;
    }
    .dcv1-account-summary {
      min-width: 0;
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      overflow: hidden;
      color: var(--dc-muted);
      font-size: 10px;
      font-weight: 400;
      opacity: .72;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-inline-spinner {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border: 1.5px solid rgba(246,200,76,.3);
      border-top-color: var(--dc-yellow);
      border-radius: 999px;
      animation: dcv1-spin .7s linear infinite;
    }
    .dcv1-inline-spinner[hidden] { display: none; }
    .dcv1-button,
    .dcv1-search {
      min-height: 32px;
      border: 1px solid var(--dc-border);
      border-radius: 9px;
      font: inherit;
      font-size: 12px;
    }
    .dcv1-button {
      padding: 0 10px;
      color: var(--dc-text);
      background: var(--dc-panel-2);
      cursor: pointer;
    }
    .dcv1-button:hover:not(:disabled) {
      border-color: rgba(246, 200, 76, .55);
      background: #2a1d37;
    }
    .dcv1-button.dcv1-toolbar-bare,
    .dcv1-button.dcv1-toolbar-bare:hover:not(:disabled) {
      min-height: 30px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }
    .dcv1-button.dcv1-toolbar-bare:hover:not(:disabled) {
      color: var(--dc-yellow);
    }
    .dcv1-button[data-primary] {
      color: #211509;
      border-color: var(--dc-yellow);
      background: var(--dc-yellow);
      font-weight: 850;
    }
    .dcv1-button[data-primary]:hover:not(:disabled) {
      color: var(--dc-yellow);
      border-color: var(--dc-yellow);
      background: #2a1d37;
    }
    .dcv1-button[data-loading="true"] {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
    }
    .dcv1-button[data-loading="true"]::before,
    .dcv1-import-spinner {
      width: 13px;
      height: 13px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 999px;
      content: "";
      animation: dcv1-spin .7s linear infinite;
    }
    @keyframes dcv1-spin { to { transform: rotate(360deg); } }
    .dcv1-button:disabled { cursor: wait; opacity: .55; }
    .dcv1-button[data-chat-import][data-loading="true"] {
      gap: 0;
    }
    .dcv1-button[data-chat-import]:disabled {
      cursor: pointer;
    }
    .dcv1-menu {
      position: relative;
    }
    .dcv1-toolbar-close {
      width: 30px;
      min-height: 30px;
      margin: 0;
      padding: 0;
      font-size: 27px;
      line-height: 1;
    }
    .dcv1-account-menu {
      display: flex;
      align-items: center;
    }
    .dcv1-account-change {
      width: 28px;
      min-height: 28px;
      padding: 5px;
      color: var(--dc-yellow);
      border: 0;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
    }
    .dcv1-account-change svg {
      width: 16px;
      height: 16px;
    }
    .dcv1-account-change:hover,
    .dcv1-account-change[aria-expanded="true"] {
      color: #ffe08a;
      background: rgba(246, 200, 76, .12);
    }
    .dcv1-menu-panel[hidden] {
      display: none !important;
    }
    .dcv1-menu-panel {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 20;
      display: grid;
      width: min(280px, calc(100vw - 28px));
      overflow: hidden;
      border: 1px solid rgba(246, 200, 76, .36);
      border-radius: 11px;
      background: #17101f;
      box-shadow: 0 16px 45px rgba(0, 0, 0, .55);
    }
    .dcv1-account-menu .dcv1-menu-panel {
      top: auto;
      right: 0;
      bottom: calc(100% + 5px);
    }
    .dcv1-menu-section {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      padding: 10px;
    }
    .dcv1-menu-section + .dcv1-menu-section {
      border-top: 1px solid rgba(255,255,255,.08);
    }
    .dcv1-account-actions {
      display: flex;
      justify-content: flex-end;
      gap: 5px;
      padding: 0 10px 10px;
    }
    .dcv1-account-choice-actions {
      display: grid;
      grid-template-columns: 1fr;
      justify-content: stretch;
    }
    .dcv1-menu-copy {
      min-width: 0;
    }
    .dcv1-menu-label {
      color: var(--dc-muted);
      font-size: 9px;
      font-weight: 750;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .dcv1-menu-state {
      margin-top: 2px;
      overflow: hidden;
      color: var(--dc-text);
      font-size: 11px;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-menu-panel .dcv1-button {
      min-height: 29px;
      padding: 0 8px;
      font-size: 10px;
    }
    .dcv1-view-tabs {
      flex: 0 0 auto;
      display: flex;
      align-items: stretch;
      gap: 2px;
      padding: 4px 8px 0;
      border-bottom: 1px solid rgba(255,255,255,.07);
      background: var(--dc-panel);
    }
    .dcv1-view-tabs .dcv1-tag-toggle {
      margin-left: auto;
      align-self: center;
      min-height: 25px;
      padding: 0 9px;
      border-radius: 999px;
      font-size: 10px;
    }
    .dcv1-view-tab {
      min-width: 76px;
      min-height: 29px;
      color: var(--dc-muted);
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      font: inherit;
      font-size: 11px;
      font-weight: 850;
      cursor: pointer;
    }
    .dcv1-view-tab[data-active="true"] {
      color: var(--dc-yellow);
      border-bottom-color: var(--dc-yellow);
    }
    .dcv1-search-row {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 42px;
      gap: 6px;
      align-items: center;
      padding: 7px 8px;
      border-bottom: 1px solid rgba(255,255,255,.07);
      background: var(--dc-panel);
    }
    .dcv1-search-row[hidden] { display: none; }
    .dcv1-search-shell {
      position: relative;
      min-width: 0;
    }
    .dcv1-search {
      width: 100%;
      padding: 0 34px 0 12px;
      color: var(--dc-text);
      outline: none;
      background: #0e0a14;
    }
    .dcv1-search::-webkit-search-cancel-button { display: none; }
    .dcv1-search-clear {
      position: absolute;
      top: 50%;
      right: 5px;
      width: 25px;
      height: 25px;
      display: grid;
      place-items: center;
      padding: 0;
      color: var(--dc-muted);
      border: 0;
      border-radius: 999px;
      background: transparent;
      font: inherit;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      transform: translateY(-50%);
    }
    .dcv1-search-clear:hover,
    .dcv1-search-clear:focus-visible {
      color: var(--dc-text);
      background: rgba(255,255,255,.08);
      outline: none;
    }
    .dcv1-search-clear[hidden] { display: none; }
    .dcv1-catalog-sort {
      position: relative;
      width: 42px;
      height: 38px;
      display: grid;
      place-items: center;
    }
    .dcv1-sort-trigger {
      position: relative;
      width: 42px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      color: var(--dc-yellow);
      border: 0;
      background: transparent;
      cursor: pointer;
    }
    .dcv1-sort-trigger:hover,
    .dcv1-sort-trigger:focus-visible {
      color: #ffe28a;
      outline: none;
    }
    .dcv1-sort-trigger svg {
      width: 28px;
      height: 28px;
    }
    .dcv1-sort-trigger[data-loading="true"] { cursor: wait; }
    .dcv1-sort-trigger[data-loading="true"] svg { visibility: hidden; }
    .dcv1-sort-spinner {
      position: absolute;
      top: 13px;
      left: 10px;
      z-index: 0;
      box-sizing: border-box;
      width: 22px;
      height: 22px;
      border: 2px solid rgba(246,200,76,.3);
      border-top-color: var(--dc-yellow);
      border-radius: 999px;
      background: #17101f;
      animation: dcv1-spin .7s linear infinite;
    }
    .dcv1-sort-spinner[hidden] { display: none; }
    .dcv1-sort-badge {
      position: absolute;
      top: -3px;
      left: 50%;
      max-width: 48px;
      overflow: hidden;
      padding: 1px 4px;
      color: #fff;
      border: 1px solid rgba(246,200,76,.42);
      border-radius: 999px;
      background: rgba(57, 42, 24, .92);
      font-size: 7px;
      font-weight: 850;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
      transform: translateX(-50%);
      z-index: 1;
    }
    .dcv1-sort-menu {
      position: absolute;
      top: calc(100% + 5px);
      right: 0;
      z-index: 40;
      min-width: 166px;
      display: grid;
      gap: 3px;
      padding: 5px;
      border: 1px solid rgba(246,200,76,.28);
      border-radius: 10px;
      background: rgba(20, 15, 27, .98);
      box-shadow: 0 16px 36px rgba(0,0,0,.48);
    }
    .dcv1-sort-menu[hidden] { display: none; }
    .dcv1-sort-option {
      width: 100%;
      min-height: 30px;
      padding: 6px 8px;
      color: var(--dc-text);
      border: 0;
      border-radius: 7px;
      background: transparent;
      font: inherit;
      font-size: 10.5px;
      text-align: left;
      cursor: pointer;
    }
    .dcv1-sort-option:hover,
    .dcv1-sort-option:focus-visible,
    .dcv1-sort-option[data-active="true"] {
      color: #211509;
      background: var(--dc-yellow);
      outline: none;
    }
    .dcv1-search:focus { border-color: var(--dc-yellow); }
    .dcv1-tag-toggle[data-active="true"] {
      color: #211509;
      border-color: var(--dc-yellow);
      background: var(--dc-yellow);
      font-weight: 500;
    }
    .dcv1-filter-chips {
      flex: 0 0 auto;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
      min-width: 0;
      padding: 0 8px 7px;
      overflow: visible;
      border-bottom: 1px solid rgba(255,255,255,.07);
      background: var(--dc-panel);
    }
    .dcv1-filter-chips[hidden] { display: none; }
    .dcv1-chip,
    .dcv1-tag {
      min-height: 22px;
      display: inline-flex;
      flex: 0 0 auto;
      gap: 5px;
      align-items: center;
      padding: 1px 7px;
      color: var(--dc-text);
      border: 1px solid rgba(246, 200, 76, .24);
      border-radius: 999px;
      background: rgba(246, 200, 76, .07);
      font: inherit;
      font-size: 10.5px;
      font-weight: 450;
      line-height: 1.05;
      cursor: pointer;
    }
    .dcv1-chip {
      color: #211509;
      border-color: var(--dc-yellow);
      background: linear-gradient(145deg, #ffdc72, var(--dc-yellow));
      font-size: 13.5px;
      font-weight: 500;
      box-shadow: 0 3px 10px rgba(246, 200, 76, .12);
    }
    .dcv1-chip:hover,
    .dcv1-tag:hover,
    .dcv1-tag[data-selected="true"] {
      border-color: var(--dc-yellow);
      background: rgba(246, 200, 76, .16);
    }
    .dcv1-chip:hover { background: #ffda67; }
    .dcv1-tag-count {
      color: var(--dc-muted);
      font-size: 11px;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }
    .dcv1-chip .dcv1-tag-count { color: rgba(33, 21, 9, .65); }
    .dcv1-tag-scrim {
      position: absolute;
      inset: 0;
      z-index: 29;
      border: 0;
      opacity: 0;
      pointer-events: none;
      background: transparent;
    }
    .dcv1-tag-scrim[data-open="true"] {
      opacity: 1;
      pointer-events: auto;
    }
    .dcv1-tag-panel {
      position: absolute;
      inset: auto 0 0;
      z-index: 30;
      width: 100%;
      height: 70%;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-top: 1px solid rgba(246, 200, 76, .34);
      border-radius: 18px 18px 0 0;
      background:
        radial-gradient(circle at 12% -5%, rgba(156, 107, 210, .24), transparent 35%),
        #130e1a;
      box-shadow: 0 -18px 42px rgba(0, 0, 0, .48);
      transform: translateY(105%);
      transition: transform .26s cubic-bezier(.2, .78, .2, 1);
    }
    .dcv1-tag-panel[data-open="true"] {
      transform: translateY(0);
    }
    .dcv1-tag-drawer-head {
      position: relative;
      flex: 0 0 auto;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      min-height: 48px;
      padding: 15px 11px 9px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .dcv1-tag-drawer-title {
      font-size: 14px;
      font-weight: 600;
    }
    .dcv1-tag-drawer-title span {
      display: block;
      margin-top: 1px;
      color: var(--dc-muted);
      font-size: 9px;
      font-weight: 400;
    }
    .dcv1-tag-drawer-handle {
      position: absolute;
      top: 6px;
      left: 50%;
      width: 38px;
      height: 3px;
      display: block;
      border-radius: 999px;
      background: rgba(246, 200, 76, .52);
      transform: translateX(-50%);
    }
    .dcv1-tag-tools {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 6px;
      padding: 8px;
    }
    .dcv1-tag-view-toggle {
      display: inline-flex;
      align-items: center;
      padding: 2px;
      border: 1px solid var(--dc-border);
      border-radius: 9px;
      background: #0e0a14;
    }
    .dcv1-tag-view-toggle button {
      min-height: 26px;
      padding: 0 8px;
      color: var(--dc-muted);
      border: 0;
      border-radius: 7px;
      background: transparent;
      font: inherit;
      font-size: 9px;
      font-weight: 500;
      cursor: pointer;
    }
    .dcv1-tag-view-toggle button[data-active="true"] {
      color: #211509;
      background: var(--dc-yellow);
    }
    .dcv1-tag-groups {
      min-height: 0;
      overflow: auto;
      padding: 0 10px 10px;
      overscroll-behavior: contain;
    }
    .dcv1-tag-group + .dcv1-tag-group {
      margin-top: 12px;
      padding-top: 11px;
      border-top: 1px solid rgba(255,255,255,.065);
    }
    .dcv1-tag-group-title {
      margin-bottom: 5px;
      color: var(--dc-muted);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .dcv1-tag-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 3px;
    }
    .dcv1-tag-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-content: flex-start;
      padding-top: 2px;
    }
    .dcv1-tag-cloud-item {
      min-height: 23px;
      display: inline-flex;
      gap: 5px;
      align-items: center;
      padding: 2px calc(6px + var(--heat, 0) * 2px);
      color: rgba(241, 229, 247, calc(.62 + var(--heat, 0) * .34));
      border: 1px solid rgba(156, 107, 210, calc(.12 + var(--heat, 0) * .32));
      border-radius: 999px;
      background: rgba(156, 107, 210, calc(.045 + var(--heat, 0) * .14));
      font: inherit;
      font-size: calc(10px + var(--heat, 0) * 3px);
      line-height: 1.05;
      font-weight: 450;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease, color .15s ease;
    }
    .dcv1-tag-cloud-item:hover,
    .dcv1-tag-cloud-item[data-selected="true"] {
      color: var(--dc-yellow);
      border-color: rgba(246, 200, 76, .7);
      background: rgba(246, 200, 76, .14);
    }
    .dcv1-tag-cloud-item[data-selected="true"] {
      box-shadow: inset 0 0 0 1px rgba(246, 200, 76, .22);
    }
    .dcv1-tag-cloud-item .dcv1-tag-count {
      color: inherit;
      font-size: .72em;
      opacity: .7;
    }
    .dcv1-tag-panel .dcv1-tag {
      width: 100%;
      min-width: 0;
      justify-content: space-between;
      text-align: left;
    }
    .dcv1-tag-panel .dcv1-tag > span:first-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-tag-panel-footer {
      flex: 0 0 auto;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      padding: 7px 8px;
      color: var(--dc-muted);
      border-top: 1px solid rgba(255,255,255,.06);
      font-size: 9px;
    }
    .dcv1-tag-infinite-sentinel {
      width: 100%;
      min-height: 38px;
      display: grid;
      margin-top: 10px;
      place-items: center;
      color: var(--dc-muted);
      border: 1px dashed rgba(246, 200, 76, .18);
      border-radius: 10px;
      background: rgba(246, 200, 76, .035);
      font: inherit;
      font-size: 9px;
    }
    .dcv1-tag-infinite-sentinel:disabled {
      cursor: default;
    }
    .dcv1-status {
      grid-column: 1 / -1;
      min-height: 14px;
      padding: 0 2px;
      overflow: hidden;
      color: var(--dc-muted);
      font-size: 10px;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-status:empty {
      display: none;
    }
    .dcv1-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    .dcv1-account-footer {
      position: relative;
      z-index: 7;
      flex: 0 0 auto;
      min-height: 24px;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      padding: 2px 9px calc(2px + env(safe-area-inset-bottom, 0px));
      overflow: visible;
      border-top: 1px solid rgba(255,255,255,.08);
      background: rgba(16, 12, 23, .96);
    }
    .dcv1-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
      gap: 11px 9px;
      padding: 9px;
    }
    .dcv1-grid[hidden] { display: none; }
    .dcv1-fresh-cover .dcv1-added-badge {
      top: auto;
      bottom: 6px;
    }
    .dcv1-card {
      min-width: 0;
      overflow: hidden;
      border: 0;
      border-radius: 11px;
      color: inherit;
      background: transparent;
      cursor: pointer;
      transition: color .15s ease;
    }
    .dcv1-card:hover,
    .dcv1-card:focus-visible {
      outline: none;
    }
    .dcv1-card:hover .dcv1-cover-wrap,
    .dcv1-card:focus-visible .dcv1-cover-wrap {
      box-shadow: 0 0 0 1px rgba(246, 200, 76, .55);
    }
    .dcv1-card[data-added="true"] .dcv1-cover-wrap {
      box-shadow: 0 0 0 1px rgba(93, 214, 153, .42);
    }
    .dcv1-cover-wrap {
      position: relative;
      aspect-ratio: 3 / 4;
      overflow: hidden;
      border-radius: 11px;
      background: #2a1d36;
      transition: box-shadow .15s ease;
    }
    .dcv1-cover {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      object-position: top center;
    }
    .dcv1-cover-missing {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      padding: 18px;
      color: rgba(246, 200, 76, .7);
      background:
        radial-gradient(circle at 50% 25%, rgba(156, 107, 210, .22), transparent 45%),
        #21172c;
      text-align: center;
    }
    .dcv1-cover-missing svg {
      width: 45px;
      opacity: .72;
    }
    .dcv1-cover-missing span {
      display: block;
      margin-top: 8px;
      color: var(--dc-muted);
      font-size: 9px;
      font-weight: 750;
    }
    .dcv1-card-score {
      position: absolute;
      right: 6px;
      bottom: 5px;
      z-index: 2;
      min-width: 46px;
      min-height: 34px;
      display: grid;
      place-items: center;
      padding: 4px 7px;
      color: #fff;
      border: 0;
      border-radius: 7px;
      background: rgba(71, 85, 105, .64);
      box-shadow: 0 2px 8px rgba(0,0,0,.3);
      font-size: 16px;
      font-weight: 750;
      line-height: 1;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .dcv1-card-score[data-tier="top"] {
      color: #fff;
      background: linear-gradient(135deg, rgba(180, 83, 9, .88), rgba(146, 64, 14, .92));
      box-shadow: 0 2px 8px rgba(0,0,0,.32), 0 0 12px rgba(245,158,11,.2);
    }
    .dcv1-card-score[data-tier="mid"] {
      background: rgba(30, 58, 138, .82);
    }
    .dcv1-card-score[data-tier="low"] {
      background: rgba(71, 85, 105, .78);
    }
    .dcv1-added-badge {
      position: absolute;
      top: 7px;
      left: 7px;
      padding: 3px 7px;
      color: #bff5d2;
      background: rgba(18, 56, 39, .88);
      border: 1px solid rgba(93, 214, 153, .48);
      border-radius: 6px;
      font-size: 9.5px;
      font-weight: 850;
      text-transform: uppercase;
    }
    .dcv1-card-date,
    .dcv1-card-token,
    .dcv1-fresh-date,
    .dcv1-fresh-token {
      position: absolute;
      z-index: 1;
      padding: 2px 6px;
      color: rgba(255,255,255,.92);
      border-radius: 6px;
      background: rgba(0,0,0,.62);
      box-shadow: 0 2px 6px rgba(0,0,0,.28);
      font-size: 9.5px;
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .dcv1-card-date,
    .dcv1-fresh-date {
      top: 7px;
      right: 7px;
    }
    .dcv1-card-token {
      bottom: 5px;
      left: 6px;
      max-width: calc(100% - 66px);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dcv1-card-body {
      display: grid;
      gap: 5px;
      padding: 6px 3px 2px;
    }
    .dcv1-name {
      overflow: hidden;
      color: var(--dc-text);
      font-size: 13px;
      font-weight: 550;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-card-author,
    .dcv1-fresh-meta {
      min-width: 0;
      display: flex;
      gap: 5px;
      align-items: center;
      overflow: hidden;
      color: var(--dc-muted);
      font-size: 10.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-author-label {
      flex: 0 0 auto;
      color: #ff5cae;
      font-size: 8px;
      font-weight: 500;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .dcv1-creator-link {
      max-width: 100%;
      padding: 0;
      overflow: hidden;
      color: rgba(236, 229, 241, .86);
      border: 0;
      background: transparent;
      font: inherit;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .dcv1-creator-link:hover { color: var(--dc-text); text-decoration: underline; }
    .dcv1-fresh-section {
      grid-column: 1 / -1;
      min-width: 0;
    }
    .dcv1-fresh-section + .dcv1-fresh-section {
      margin-top: 8px;
      padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,.075);
    }
    .dcv1-fresh-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 8px;
      padding: 0 2px;
    }
    .dcv1-fresh-head strong {
      color: var(--dc-text);
      font-size: 13px;
      font-weight: 900;
    }
    .dcv1-fresh-head span {
      color: var(--dc-muted);
      font-size: 9px;
    }
    .dcv1-fresh-list {
      display: grid;
      gap: 14px;
    }
    .dcv1-fresh-row {
      position: relative;
      min-width: 0;
      min-height: 158px;
      display: grid;
      grid-template-columns: 100px minmax(0, 1fr) 60px;
      grid-template-rows: auto minmax(0, 1fr);
      column-gap: 9px;
      row-gap: 6px;
      align-items: stretch;
      padding: 0 0 14px;
      color: inherit;
      border: 0;
      border-bottom: 1px solid rgba(255,255,255,.075);
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .dcv1-fresh-row:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }
    .dcv1-fresh-row:hover,
    .dcv1-fresh-row:focus-visible {
      background: rgba(255,255,255,.025);
      outline: none;
    }
    .dcv1-fresh-cover {
      position: relative;
      grid-column: 1;
      grid-row: 2;
      width: 100px;
      min-height: 126px;
      overflow: hidden;
      border-radius: 10px;
      background: #21172c;
    }
    .dcv1-fresh-cover .dcv1-cover-missing {
      padding: 8px;
    }
    .dcv1-fresh-cover .dcv1-cover-missing svg {
      width: 30px;
    }
    .dcv1-fresh-cover .dcv1-cover-missing span {
      display: none;
    }
    .dcv1-fresh-copy {
      min-width: 0;
      grid-column: 2;
      grid-row: 2;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 5px;
      align-content: start;
      overflow: hidden;
      padding: 2px 0;
    }
    .dcv1-fresh-title {
      grid-column: 1 / -1;
      grid-row: 1;
      overflow: hidden;
      color: var(--dc-text);
      display: -webkit-box;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .dcv1-fresh-meta { font-size: 11px; }
    .dcv1-fresh-description {
      display: -webkit-box;
      margin: 0;
      overflow: hidden;
      color: rgba(226, 216, 232, .76);
      font-size: 12px;
      font-style: italic;
      line-height: 1.3;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .dcv1-imports {
      grid-column: 1 / -1;
      display: grid;
      gap: 6px;
      padding: 7px;
    }
    .dcv1-imports-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      padding: 0 2px;
    }
    .dcv1-imports-head strong {
      font-size: 12px;
    }
    .dcv1-imports-head span {
      color: var(--dc-muted);
      font-size: 9px;
    }
    .dcv1-import-list {
      display: grid;
      gap: 4px;
    }
    .dcv1-import-row {
      min-width: 0;
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      gap: 7px;
      align-items: center;
      padding: 5px;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 8px;
      background: rgba(255,255,255,.025);
    }
    .dcv1-import-row-avatar {
      width: 40px;
      height: 46px;
      overflow: hidden;
      border-radius: 8px;
      background: #21172c;
    }
    .dcv1-import-row-avatar img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      object-position: center top;
    }
    .dcv1-import-row-copy { min-width: 0; }
    .dcv1-import-row-title {
      overflow: hidden;
      color: var(--dc-text);
      font-size: 11.5px;
      font-weight: 750;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-import-row-time {
      margin-top: 2px;
      color: var(--dc-muted);
      font-size: 8.5px;
    }
    .dcv1-import-row-actions {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .dcv1-import-row-actions .dcv1-button {
      min-height: 25px;
      padding: 0 6px;
      font-size: 9px;
    }
    .dcv1-fresh-tags {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-height: 38px;
      overflow: hidden;
    }
    .dcv1-fresh-tag {
      padding: 2px 6px;
      color: #d7cbe0;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 999px;
      background: rgba(255,255,255,.035);
      font-size: 9.5px;
      line-height: 1;
      white-space: nowrap;
    }
    .dcv1-fresh-rail {
      min-width: 0;
      grid-column: 3;
      grid-row: 2;
      display: flex;
      align-items: stretch;
      flex-direction: column;
      gap: 5px;
      padding: 2px 0;
      text-align: right;
    }
    .dcv1-fresh-age {
      color: #f9a8d4;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0;
      line-height: 1.05;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .dcv1-fresh-score {
      width: 54px;
      min-width: 0;
      min-height: 39px;
      display: grid;
      place-items: center;
      margin-left: auto;
      padding: 2px;
      color: #fff;
      border-radius: 7px;
      background: rgba(71, 85, 105, .64);
      box-shadow: 0 2px 8px rgba(0,0,0,.28);
      font-size: 15px;
      font-weight: 750;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .dcv1-fresh-score[data-tier="top"] {
      background: linear-gradient(135deg, rgba(180, 83, 9, .88), rgba(146, 64, 14, .92));
      box-shadow: 0 2px 8px rgba(0,0,0,.3), 0 0 12px rgba(245,158,11,.2);
    }
    .dcv1-fresh-score[data-tier="mid"] { background: rgba(30, 58, 138, .82); }
    .dcv1-fresh-score[data-tier="low"] { background: rgba(71, 85, 105, .78); }
    .dcv1-fresh-metric {
      display: grid;
      gap: 1px;
      margin-top: auto;
      color: var(--dc-muted);
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: .035em;
      text-transform: uppercase;
    }
    .dcv1-fresh-metric strong {
      color: var(--dc-text);
      font-size: 12px;
      font-weight: 800;
    }
    .dcv1-fresh-rail .dcv1-button {
      width: 100%;
      min-height: 29px;
      padding: 0;
      font-size: 10px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -.01em;
    }
    .dcv1-fresh-rail .dcv1-button[data-import] {
      width: auto;
      min-width: 0;
      align-self: flex-end;
      padding: 0 5px;
      font-size: 11px;
    }
    .dcv1-fresh-spotted {
      overflow: hidden;
      color: #d5b0ff;
      font-size: 10px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-fresh-token {
      bottom: 6px;
      left: 50%;
      max-width: calc(100% - 12px);
      overflow: hidden;
      text-overflow: ellipsis;
      transform: translateX(-50%);
    }
    .dcv1-community {
      display: grid;
      gap: 9px;
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid rgba(255,255,255,.08);
    }
    .dcv1-community-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }
    .dcv1-community-head strong {
      color: var(--dc-text);
      font-size: 13px;
      font-weight: 900;
    }
    .dcv1-community-counts {
      color: var(--dc-muted);
      font-size: 9px;
    }
    .dcv1-community-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .dcv1-community-actions .dcv1-button[data-kudos] {
      color: #ffd0e7;
      border-color: rgba(244,114,182,.42);
      background: rgba(244,114,182,.1);
    }
    .dcv1-kudos-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .dcv1-kudos-count {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      min-height: 22px;
      padding: 2px 6px;
      color: #eadff0;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 999px;
      background: rgba(255,255,255,.035);
      font-size: 9px;
      font-weight: 800;
    }
    .dcv1-kudos-count span {
      font-size: 13px;
      line-height: 1;
    }
    .dcv1-kudos-picker {
      display: grid;
      gap: 7px;
      padding: 9px;
      border: 1px solid rgba(244,114,182,.25);
      border-radius: 10px;
      background: rgba(244,114,182,.045);
    }
    .dcv1-kudos-picker-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      color: var(--dc-muted);
      font-size: 9px;
    }
    .dcv1-kudos-picker-head strong {
      color: var(--dc-text);
      font-size: 10.5px;
    }
    .dcv1-kudos-picker-close {
      padding: 2px 5px;
      color: var(--dc-muted);
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
      font-size: 9px;
    }
    .dcv1-kudos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
      gap: 5px;
    }
    .dcv1-kudos-option {
      min-width: 0;
      min-height: 42px;
      display: grid;
      grid-template-columns: 25px minmax(0, 1fr);
      gap: 6px;
      align-items: center;
      padding: 5px 7px;
      color: var(--dc-text);
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 8px;
      background: rgba(255,255,255,.03);
      cursor: pointer;
      font: inherit;
      text-align: left;
    }
    .dcv1-kudos-option:hover:not(:disabled) {
      border-color: rgba(244,114,182,.5);
      background: rgba(244,114,182,.1);
    }
    .dcv1-kudos-option:disabled {
      cursor: wait;
      opacity: .68;
    }
    .dcv1-kudos-emoji {
      font-size: 21px;
      line-height: 1;
      text-align: center;
    }
    .dcv1-kudos-copy {
      min-width: 0;
      display: grid;
      gap: 1px;
    }
    .dcv1-kudos-copy strong,
    .dcv1-kudos-copy span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-kudos-copy strong {
      color: var(--dc-text);
      font-size: 9px;
    }
    .dcv1-kudos-copy span {
      color: var(--dc-muted);
      font-size: 7.5px;
    }
    .dcv1-community-comments {
      display: grid;
      gap: 7px;
    }
    .dcv1-community-comment {
      display: grid;
      gap: 3px;
      padding: 8px 9px;
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 9px;
      background: rgba(255,255,255,.025);
    }
    .dcv1-community-comment-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--dc-muted);
      font-size: 8.5px;
    }
    .dcv1-community-comment-head strong {
      overflow: hidden;
      color: var(--dc-yellow);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-community-comment p {
      margin: 0;
      color: #ded4e2;
      font-size: 10.5px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .dcv1-community-composer {
      display: grid;
      gap: 6px;
    }
    .dcv1-community-composer textarea {
      width: 100%;
      min-height: 74px;
      resize: vertical;
      padding: 8px 9px;
      color: var(--dc-text);
      border: 1px solid var(--dc-border);
      border-radius: 9px;
      outline: none;
      background: #0e0a14;
      font: inherit;
      font-size: 11px;
      line-height: 1.4;
    }
    .dcv1-community-composer textarea:focus {
      border-color: var(--dc-yellow);
    }
    .dcv1-community-composer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }
    .dcv1-card-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
    }
    .dcv1-card-actions > :only-child {
      grid-column: 1 / -1;
    }
    .dcv1-card-actions .dcv1-button {
      padding: 0 8px;
    }
    .dcv1-card-actions .dcv1-button[data-import] {
      padding: 0 8px;
      font-size: 13px;
    }
    .dcv1-button[data-added] {
      color: #bff5d2;
      border-color: rgba(93, 214, 153, .42);
      background: rgba(93, 214, 153, .1);
      font-weight: 800;
    }
    .dcv1-button[data-added]:disabled {
      cursor: default;
      opacity: 1;
    }
    .dcv1-native-launch {
      width: 100%;
      height: 48px;
      flex: 0 0 48px;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      padding: 13px;
      color: #f6c84c;
      border: 0;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      transition:
        background var(--lumiverse-transition-fast, 120ms),
        color var(--lumiverse-transition-fast, 120ms),
        border-color var(--lumiverse-transition-fast, 120ms);
    }
    .dcv1-native-launch:hover {
      color: #ffe08a;
      background: var(--lumiverse-primary-015, var(--lumiverse-fill-hover));
    }
    .dcv1-native-launch[data-active="true"] {
      color: #f6c84c !important;
      background: rgba(246, 200, 76, .14);
      box-shadow: inset 3px 0 0 #f6c84c;
    }
    .dcv1-native-launch svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .dcv1-native-scroll-tab {
      display: none !important;
    }
    .dcv1-infinite-sentinel {
      min-height: 54px;
      display: flex;
      justify-content: center;
      gap: 8px;
      align-items: center;
      padding: 8px 12px 18px;
      color: var(--dc-muted);
      border: 0;
      background: transparent;
      font: inherit;
      font-size: 10px;
    }
    button.dcv1-infinite-sentinel:not(:disabled) { cursor: pointer; }
    .dcv1-infinite-sentinel[hidden] { display: none; }
    .dcv1-infinite-sentinel[data-loading="true"]::before {
      width: 13px;
      height: 13px;
      border: 2px solid var(--dc-yellow);
      border-right-color: transparent;
      border-radius: 999px;
      content: "";
      animation: dcv1-spin .7s linear infinite;
    }
    .dcv1-empty {
      grid-column: 1 / -1;
      padding: 48px 20px;
      color: var(--dc-muted);
      text-align: center;
    }
    .dcv1-empty[data-error] { color: #ff9da8; }
    .dcv1-loading-state {
      min-height: min(320px, 48dvh);
      display: flex;
      flex-direction: column;
      gap: 13px;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
    }
    .dcv1-loader-visual {
      position: relative;
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      color: var(--dc-yellow);
      border-radius: 999px;
      background: radial-gradient(circle, rgba(246,200,76,.13), rgba(246,200,76,0) 67%);
      filter: drop-shadow(0 0 12px rgba(246,200,76,.14));
    }
    .dcv1-loader-visual::before {
      position: absolute;
      inset: 0;
      border: 2px solid rgba(246,200,76,.16);
      border-top-color: var(--dc-yellow);
      border-right-color: rgba(246,200,76,.58);
      border-radius: inherit;
      content: "";
      animation: dcv1-spin .82s linear infinite;
    }
    .dcv1-loader-visual svg {
      width: 27px;
      height: 27px;
      animation: dcv1-loader-pulse 1.25s ease-in-out infinite;
    }
    .dcv1-loader-copy {
      color: var(--dc-muted);
      font-size: 11px;
      letter-spacing: .01em;
    }
    @keyframes dcv1-loader-pulse {
      0%, 100% { opacity: .68; transform: scale(.94); }
      50% { opacity: 1; transform: scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .dcv1-loader-visual::before,
      .dcv1-loader-visual svg { animation: none; }
    }
    .dcv1-import-tray {
      position: absolute;
      right: 10px;
      bottom: 29px;
      left: 10px;
      z-index: 8;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 11px;
      color: var(--dc-text);
      border: 1px solid rgba(246, 200, 76, .35);
      border-radius: 13px;
      background: rgba(25, 18, 33, .97);
      box-shadow: 0 16px 42px rgba(0, 0, 0, .45);
      backdrop-filter: blur(14px);
    }
    .dcv1-import-tray[hidden] { display: none; }
    .dcv1-import-tray[data-tone="success"] {
      border-color: rgba(93, 214, 153, .48);
    }
    .dcv1-import-tray[data-tone="error"] {
      border-color: rgba(255, 111, 128, .55);
    }
    .dcv1-import-tray[data-tone="verification"] {
      border-color: rgba(156, 107, 210, .72);
    }
    .dcv1-import-icon {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      color: var(--dc-yellow);
      border-radius: 999px;
      background: rgba(246, 200, 76, .12);
      font-size: 17px;
      font-weight: 900;
    }
    .dcv1-import-tray[data-tone="success"] .dcv1-import-icon {
      color: #79e6ac;
      background: rgba(93, 214, 153, .13);
    }
    .dcv1-import-tray[data-tone="error"] .dcv1-import-icon {
      color: #ff8b98;
      background: rgba(255, 111, 128, .13);
    }
    .dcv1-import-tray[data-tone="verification"] .dcv1-import-icon {
      color: #d5b0ff;
      background: rgba(156, 107, 210, .18);
    }
    .dcv1-import-copy {
      min-width: 0;
    }
    .dcv1-import-title {
      overflow: hidden;
      font-size: 12px;
      font-weight: 850;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-import-detail {
      margin-top: 2px;
      overflow: hidden;
      color: var(--dc-muted);
      font-size: 10px;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-import-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .dcv1-import-actions .dcv1-button {
      min-height: 30px;
      padding: 0 9px;
      font-size: 10px;
    }
    .dcv1-import-actions .dcv1-import-close {
      width: 30px;
      padding: 0;
      color: var(--dc-muted);
      font-size: 20px;
      line-height: 1;
    }
    .dcv1-profile {
      position: absolute;
      inset: 0;
      z-index: 24;
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--dc-bg);
    }
    .dcv1-profile-nav {
      flex: 0 0 auto;
      display: flex;
      gap: 10px;
      align-items: center;
      min-height: 48px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--dc-border);
      background: rgba(16, 12, 23, .96);
    }
    .dcv1-profile-nav-title {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      color: var(--dc-muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .08em;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .dcv1-profile-avatar {
      width: 106px;
      height: 106px;
      border: 2px solid rgba(246, 200, 76, .32);
      border-radius: 24px;
      object-fit: cover;
      background: #2a1d36;
    }
    .dcv1-profile-title {
      overflow: hidden;
      margin: 0;
      font-size: clamp(23px, 4vw, 36px);
      font-weight: 900;
      text-overflow: ellipsis;
      line-height: 1.05;
    }
    .dcv1-profile-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      color: #ded4e2;
      line-height: 1.55;
      overscroll-behavior: contain;
    }
    .dcv1-creator-page {
      width: min(1050px, 100%);
      margin: 0 auto;
      padding: 18px;
    }
    .dcv1-creator-hero {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 18px;
      align-items: center;
      overflow: hidden;
      padding: 20px;
      border: 1px solid rgba(246, 200, 76, .2);
      border-radius: 20px;
      background:
        radial-gradient(circle at 88% 0, rgba(156, 107, 210, .34), transparent 45%),
        linear-gradient(145deg, #23172f, #17101f);
      box-shadow: 0 18px 44px rgba(0,0,0,.25);
    }
    .dcv1-creator-identity,
    .dcv1-creator-stat-strip {
      grid-column: 1 / -1;
    }
    .dcv1-creator-media {
      display: grid;
      justify-items: start;
      gap: 8px;
    }
    .dcv1-creator-tag-panel {
      min-width: 0;
      align-self: stretch;
      padding: 10px 12px;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 12px;
      background: rgba(0,0,0,.12);
    }
    .dcv1-creator-tag-heading {
      color: var(--dc-muted);
      font-size: 8px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .dcv1-creator-tag-panel .dcv1-profile-tags { margin-top: 8px; }
    .dcv1-creator-tags-empty {
      margin-top: 8px;
      color: var(--dc-muted);
      font-size: 10px;
    }
    .dcv1-creator-kicker {
      margin-bottom: 4px;
      color: var(--dc-yellow);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .dcv1-creator-handle {
      margin-top: 6px;
      color: var(--dc-muted);
      font-size: 12px;
    }
    .dcv1-verified {
      display: inline-grid;
      width: 18px;
      height: 18px;
      margin-left: 5px;
      place-items: center;
      color: #211509;
      border-radius: 999px;
      background: var(--dc-yellow);
      font-size: 11px;
      vertical-align: .18em;
    }
    .dcv1-creator-stat-strip,
    .dcv1-character-stat-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 14px;
    }
    .dcv1-creator-hero .dcv1-creator-stat-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 7px;
      margin-top: 0;
    }
    .dcv1-creator-hero .dcv1-stat { min-width: 0; }
    .dcv1-stat {
      min-width: 84px;
      display: grid;
      gap: 1px;
      padding: 7px 10px;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 10px;
      background: rgba(7,5,10,.3);
    }
    .dcv1-stat strong {
      color: var(--dc-text);
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
    .dcv1-stat span {
      color: var(--dc-muted);
      font-size: 8px;
      font-weight: 800;
      letter-spacing: .07em;
      text-transform: uppercase;
    }
    .dcv1-creator-about,
    .dcv1-creator-catalog {
      margin-top: 14px;
      padding: 17px;
      border: 1px solid rgba(255,255,255,.085);
      border-radius: 16px;
      background: rgba(25, 18, 33, .82);
    }
    .dcv1-section-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      margin-bottom: 10px;
    }
    .dcv1-section-head h2 {
      margin: 0;
      color: var(--dc-text);
      font-size: 14px;
      font-weight: 900;
    }
    .dcv1-section-head span {
      color: var(--dc-muted);
      font-size: 9px;
    }
    .dcv1-creator-about-copy {
      max-width: 850px;
      color: #ded4e2;
      font-size: 12px;
      line-height: 1.65;
      white-space: pre-wrap;
    }
    .dcv1-profile-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 13px;
    }
    .dcv1-creator-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 5px;
      color: var(--dc-muted);
      font-size: 10px;
    }
    .dcv1-creator-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .dcv1-modal-layer {
      position: absolute;
      inset: 0;
      z-index: 35;
      display: grid;
      place-items: center;
      padding: 0;
      background: rgba(4, 3, 7, .78);
      backdrop-filter: blur(5px);
    }
    /* Full view is the default: the character modal always fills the screen. */
    .dcv1-page-modal-host .dcv1-character-modal {
      position: fixed !important;
      inset: 0 !important;
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      transform: none !important;
      box-sizing: border-box;
      padding-top: env(safe-area-inset-top, 0px);
      padding-bottom: env(safe-area-inset-bottom, 0px);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
      border: 0;
      border-radius: 0;
      background: #17101f;
    }
    .dcv1-character-modal-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      min-height: 48px;
      padding: 7px 10px 7px 15px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .dcv1-character-modal-head span {
      color: var(--dc-muted);
      font-size: 9px;
      font-weight: 850;
      letter-spacing: .09em;
      text-transform: none;
    }
    .dcv1-character-modal-body {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(240px, 36%) minmax(0, 1fr);
      overflow: hidden;
    }
    .dcv1-character-hero {
      position: relative;
      min-height: 0;
      overflow: hidden;
      background: #291d35;
    }
    .dcv1-character-hero .dcv1-cover {
      object-position: center top;
    }
    .dcv1-character-hero .dcv1-cover-missing {
      position: absolute;
      inset: 0;
    }
    .dcv1-score-badge {
      position: absolute;
      right: 12px;
      bottom: 12px;
      min-width: 68px;
      display: grid;
      padding: 8px 10px;
      color: #fff;
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 12px;
      background: rgba(16,12,23,.88);
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
      text-align: center;
    }
    .dcv1-score-badge[data-tier="top"] {
      color: #231809;
      border-color: #ffe18c;
      background: linear-gradient(145deg, #ffe384, #f2b92e);
    }
    .dcv1-score-badge[data-tier="mid"] {
      border-color: rgba(192, 142, 240, .72);
      background: linear-gradient(145deg, #7449a3, #4e2f70);
    }
    .dcv1-score-badge[data-tier="low"] {
      border-color: rgba(255, 139, 152, .55);
      background: #552933;
    }
    .dcv1-score-badge strong {
      font-size: 18px;
      line-height: 1;
    }
    .dcv1-score-badge span {
      margin-top: 3px;
      font-size: 7px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .dcv1-character-info {
      min-height: 0;
      overflow: auto;
      padding: 28px 32px 32px;
      scrollbar-gutter: stable;
    }
    .dcv1-character-name {
      margin: 0;
      color: var(--dc-text);
      font-size: clamp(24px, 4vw, 38px);
      line-height: 1.04;
    }
    .dcv1-character-byline {
      margin-top: 7px;
      color: var(--dc-muted);
      font-size: 11px;
    }
    .dcv1-character-byline .dcv1-creator-link {
      padding: 3px 11px;
      border: 1px solid rgba(219, 39, 119, .55);
      border-radius: 999px;
      background: rgba(219, 39, 119, .14);
      color: #ffd9ea;
      font-weight: 600;
    }
    .dcv1-detail-section {
      margin-top: 26px;
      min-width: 0;
    }
    .dcv1-detail-heading {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0 0 11px;
      padding-bottom: 8px;
      color: var(--dc-yellow);
      border-bottom: 1px solid rgba(255,255,255,.08);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .dcv1-detail-heading span {
      padding: 1px 7px;
      color: var(--dc-muted);
      border-radius: 999px;
      background: rgba(255,255,255,.07);
      font-size: 10px;
      letter-spacing: 0;
    }
    .dcv1-detail-section .dcv1-profile-tags { margin-top: 0; }
    .dcv1-lore-chip {
      width: fit-content;
      max-width: 100%;
      display: inline-flex;
      gap: 7px;
      align-items: center;
      margin-top: 16px;
      padding: 6px 12px;
      color: #f4e3ff;
      border: 1px solid rgba(192, 142, 240, .5);
      border-radius: 999px;
      background: rgba(116, 73, 163, .28);
      font-size: 12px;
    }
    .dcv1-lore-chip span:last-child {
      color: var(--dc-muted);
      font-size: 11px;
    }
    .dcv1-rich {
      max-width: 88ch;
      color: #ece4f1;
      font-size: 15px;
      line-height: 1.75;
      overflow-wrap: anywhere;
      text-wrap: pretty;
    }
    .dcv1-rich > :first-child { margin-top: 0; }
    .dcv1-rich > :last-child { margin-bottom: 0; }
    .dcv1-rich p { margin: 0 0 1em; }
    .dcv1-rich li > p,
    .dcv1-rich td > p,
    .dcv1-rich th > p,
    .dcv1-rich summary > p { margin: 0; }
    .dcv1-rich strong { color: inherit; font-weight: 700; }
    .dcv1-rich h2,
    .dcv1-rich h3,
    .dcv1-rich h4,
    .dcv1-rich h5,
    .dcv1-rich h6 {
      margin: 1.7em 0 .6em;
      color: inherit;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -.01em;
    }
    .dcv1-rich h2 {
      padding-bottom: .3em;
      border-bottom: 1px solid rgba(255,255,255,.1);
      font-size: 1.55em;
    }
    .dcv1-rich h3 { font-size: 1.3em; }
    .dcv1-rich h4 { font-size: 1.12em; }
    .dcv1-rich h5,
    .dcv1-rich h6 {
      font-size: .8em;
      letter-spacing: .1em;
      text-transform: uppercase;
      opacity: .8;
    }
    .dcv1-rich ul,
    .dcv1-rich ol { margin: 0 0 1em; padding-left: 1.5em; }
    .dcv1-rich li { margin: .3em 0; }
    .dcv1-rich li::marker { color: var(--dc-yellow); }
    .dcv1-rich blockquote {
      margin: 0 0 1em;
      padding: 10px 16px;
      color: #d9cfe0;
      border-left: 3px solid rgba(246, 200, 76, .55);
      border-radius: 0 10px 10px 0;
      background: rgba(255,255,255,.04);
    }
    .dcv1-rich hr {
      height: 1px;
      margin: 1.8em 0;
      border: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent);
    }
    .dcv1-rich code {
      padding: 1px 6px;
      border-radius: 5px;
      background: rgba(255,255,255,.09);
      font-size: .88em;
    }
    .dcv1-rich pre {
      margin: 0 0 1em;
      padding: 12px 14px;
      overflow: auto;
      border-radius: 10px;
      background: rgba(0,0,0,.38);
    }
    .dcv1-rich pre code { padding: 0; background: none; }
    .dcv1-rich a {
      color: var(--dc-yellow);
      text-decoration-color: rgba(246, 200, 76, .4);
      text-underline-offset: 2px;
    }
    .dcv1-rich mark {
      padding: 0 3px;
      color: inherit;
      border-radius: 3px;
      background: rgba(246, 200, 76, .28);
    }
    .dcv1-rich small { opacity: .8; }
    .dcv1-rich-table {
      max-width: 100%;
      margin: 0 0 1em;
      overflow-x: auto;
    }
    .dcv1-rich table { border-collapse: collapse; }
    .dcv1-rich td,
    .dcv1-rich th {
      padding: 7px 11px;
      border: 1px solid rgba(255,255,255,.13);
      vertical-align: top;
    }
    .dcv1-rich th {
      background: rgba(255,255,255,.07);
      text-align: left;
    }
    .dcv1-rich details {
      margin: 0 0 1em;
      padding: 4px 16px;
      border: 1px solid rgba(255,255,255,.13);
      border-radius: 12px;
      background: rgba(255,255,255,.035);
    }
    .dcv1-rich summary {
      padding: 8px 0;
      font-weight: 700;
      cursor: pointer;
    }
    .dcv1-rich details[open] > summary {
      margin-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,.1);
    }
    /* Same as the Datacat site: natural size, never wider than the column,
       never cropped or height-capped (tall banners show in full). */
    .dcv1-rich-img {
      display: block;
      width: auto;
      max-width: 100%;
      height: auto;
      margin: .6em auto 1em;
      border-radius: 10px;
      cursor: zoom-in;
    }
    .dcv1-rich-img[data-sized="true"] {
      display: inline-block;
      vertical-align: top;
      margin: 0.3em 3px 0.6em;
    }
    .dcv1-rich-img[data-small="true"] {
      display: inline-block;
      width: auto;
      margin: 0 4px;
      vertical-align: middle;
    }
    .dcv1-rich [style*="flex"] > .dcv1-rich-img {
      min-width: 0;
      margin: 0;
    }
    .dcv1-rich-empty {
      margin: 0;
      color: var(--dc-muted);
      font-size: 13px;
    }
    .dcv1-card-tabs {
      display: flex;
      gap: 6px;
      margin: 0 0 14px;
      padding-bottom: 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .dcv1-card-tabs::-webkit-scrollbar { display: none; }
    .dcv1-card-tab {
      flex: none;
      padding: 6px 13px;
      color: var(--dc-muted);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 999px;
      background: rgba(255,255,255,.04);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .dcv1-card-tab span { opacity: .7; }
    .dcv1-card-tab[aria-selected="true"] {
      color: #17101f;
      border-color: var(--dc-yellow);
      background: var(--dc-yellow);
    }
    .dcv1-alt-greeting + .dcv1-alt-greeting {
      margin-top: 1.4em;
      padding-top: 1.2em;
      border-top: 1px solid rgba(255,255,255,.1);
    }
    .dcv1-full-section + .dcv1-full-section {
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid rgba(255,255,255,.1);
    }
    .dcv1-full-section > h3 { margin: 0 0 8px; font-size: 12px; color: var(--dc-yellow); letter-spacing: .08em; text-transform: uppercase; }
    .dcv1-alt-greeting > h3 { margin-top: 0; font-size: 12px; color: var(--dc-yellow); letter-spacing: .08em; text-transform: uppercase; }
    .dcv1-card-load {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 16px;
      padding: 12px 14px;
      border: 1px dashed rgba(255,255,255,.16);
      border-radius: 12px;
      color: var(--dc-muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .dcv1-card-load span { flex: 1 1 200px; min-width: 0; }
    .dcv1-gallery {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 132px;
      gap: 10px;
      padding-bottom: 6px;
      overflow-x: auto;
      scroll-snap-type: x proximity;
    }
    .dcv1-gallery-item {
      width: 132px;
      height: 132px;
      padding: 0;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px;
      background: rgba(255,255,255,.04);
      cursor: zoom-in;
      scroll-snap-align: start;
    }
    .dcv1-gallery-item:hover,
    .dcv1-gallery-item:focus-visible { border-color: var(--dc-yellow); }
    .dcv1-gallery-item img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }
    .dcv1-lightbox {
      position: absolute;
      inset: 0;
      z-index: 60;
      display: grid;
      place-items: center;
      padding: 20px;
      outline: none;
      background: rgba(4, 3, 7, .92);
      cursor: zoom-out;
    }
    .dcv1-lightbox img {
      max-width: 100%;
      max-height: 100%;
      border-radius: 10px;
      object-fit: contain;
    }
    .dcv1-character-modal-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      padding: 10px;
      border-top: 1px solid rgba(255,255,255,.08);
      background: var(--dc-panel);
    }
    .dcv1-character-added-text {
      margin-right: auto;
      color: #79e6ac;
      font-size: 11px;
      font-weight: 600;
    }
    .dcv1-local-profile {
      display: flex;
      flex-direction: column;
      gap: 12px;
      color: var(--lumiverse-text, #f5f1f8);
    }
    .dcv1-local-hero {
      position: relative;
      height: min(52vh, 480px);
      min-height: 280px;
      overflow: hidden;
      border: 1px solid var(--lumiverse-border, rgba(255,255,255,.12));
      border-radius: 14px;
      background: var(--lumiverse-bg-deep, #100c17);
    }
    .dcv1-local-hero img {
      position: relative;
      z-index: 1;
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      object-position: center 28%;
    }
    .dcv1-local-avatar-fallback {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--lumiverse-primary-muted, #9c6bd2);
      background: var(--lumiverse-primary-010, rgba(156,107,210,.12));
      font-size: 64px;
      font-weight: 700;
    }
    .dcv1-local-hero-copy {
      position: absolute;
      z-index: 2;
      inset: auto 0 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 70px 18px 20px;
      background: linear-gradient(to bottom, transparent, rgba(11,8,15,.88));
      text-align: center;
    }
    .dcv1-local-hero-copy h3 {
      margin: 0;
      color: #fff;
      font-size: 24px;
      line-height: 1.1;
      text-shadow: 0 2px 12px rgba(0,0,0,.75);
    }
    .dcv1-local-creator {
      color: rgba(255,255,255,.72);
      font-size: 12px;
    }
    .dcv1-local-tags {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px;
    }
    .dcv1-local-tag {
      padding: 2px 7px;
      color: rgba(255,255,255,.82);
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 6px;
      background: rgba(0,0,0,.28);
      font-size: 10px;
      font-weight: 400;
    }
    .dcv1-local-section {
      overflow: hidden;
      border: 1px solid var(--lumiverse-border, rgba(255,255,255,.1));
      border-radius: 10px;
      background: var(--lumiverse-fill-subtle, rgba(255,255,255,.035));
    }
    .dcv1-local-section summary {
      padding: 10px 12px;
      color: var(--lumiverse-text, #f5f1f8);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .dcv1-local-section-copy {
      padding: 0 12px 13px;
      color: var(--lumiverse-text-muted, #b9adbf);
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .dcv1-local-empty {
      color: var(--lumiverse-text-dim, #7e7484);
      font-style: italic;
    }
    .dcv1-chat-picker {
      display: grid;
      gap: 8px;
      color: var(--lumiverse-text, #f5f1f8);
    }
    .dcv1-chat-picker-count {
      margin: 0 2px 2px;
      color: var(--lumiverse-text-dim, #7e7484);
      font-size: 11px;
    }
    .dcv1-chat-choice {
      width: 100%;
      display: grid;
      gap: 5px;
      padding: 12px 14px;
      color: inherit;
      border: 1px solid var(--lumiverse-border, rgba(255,255,255,.1));
      border-radius: 10px;
      background: var(--lumiverse-fill-subtle, rgba(255,255,255,.035));
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease, transform .15s ease;
    }
    .dcv1-chat-choice:hover:not(:disabled),
    .dcv1-chat-choice:focus-visible {
      border-color: var(--lumiverse-primary-050, rgba(156,107,210,.5));
      background: var(--lumiverse-fill, rgba(255,255,255,.06));
      outline: none;
      transform: translateX(2px);
    }
    .dcv1-chat-choice[data-new-chat] {
      color: var(--lumiverse-primary-text, #d8bdf3);
      border-color: var(--lumiverse-primary-050, rgba(156,107,210,.5));
      border-style: dashed;
      background: var(--lumiverse-primary-010, rgba(156,107,210,.1));
    }
    .dcv1-chat-choice:disabled {
      cursor: wait;
      opacity: .58;
    }
    .dcv1-chat-choice-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .dcv1-chat-choice-label {
      overflow: hidden;
      color: var(--lumiverse-text, #f5f1f8);
      font-size: 13px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dcv1-chat-choice-badge {
      flex: 0 0 auto;
      padding: 2px 7px;
      color: var(--lumiverse-primary-text, #d8bdf3);
      border-radius: 999px;
      background: var(--lumiverse-primary-010, rgba(156,107,210,.1));
      font-size: 9px;
      font-weight: 600;
    }
    .dcv1-chat-choice-preview {
      display: -webkit-box;
      overflow: hidden;
      color: var(--lumiverse-text-muted, #b9adbf);
      font-size: 12px;
      font-style: italic;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 4;
    }
    .dcv1-chat-choice-meta,
    .dcv1-chat-picker-error {
      color: var(--lumiverse-text-dim, #7e7484);
      font-size: 10px;
    }
    .dcv1-chat-picker-error {
      min-height: 14px;
      color: #ffadb6;
    }
    .dcv1-chat-picker-error:empty {
      display: none;
    }
    @media (max-width: 720px) {
      .dcv1-search-row { grid-template-columns: minmax(0, 1fr) 42px; }
      .dcv1-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding: 7px; }
      .dcv1-fresh-row {
        grid-template-columns: 84px minmax(0, 1fr) 56px;
        column-gap: 7px;
        row-gap: 5px;
        min-height: 150px;
      }
      .dcv1-fresh-cover {
        width: 84px;
        min-height: 118px;
      }
      .dcv1-fresh-title { font-size: 13.5px; }
      .dcv1-fresh-description { font-size: 11px; -webkit-line-clamp: 3; }
      .dcv1-fresh-age { font-size: 10px; }
      .dcv1-fresh-score {
        width: 49px;
        min-width: 0;
        min-height: 36px;
        font-size: 14px;
      }
      .dcv1-fresh-metric { font-size: 8px; }
      .dcv1-fresh-metric strong { font-size: 11px; }
      .dcv1-card-score {
        min-width: 43px;
        min-height: 32px;
        font-size: 14px;
      }
      .dcv1-creator-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
      .dcv1-card-body { padding: 5px 2px 2px; }
      .dcv1-tag-panel {
        inset: auto 0 0;
        width: 100%;
        height: 70%;
        border-top: 1px solid rgba(246, 200, 76, .34);
        border-right: 0;
        border-radius: 17px 17px 0 0;
        transform: translateY(105%);
      }
      .dcv1-tag-panel[data-open="true"] {
        transform: translateY(0);
      }
      .dcv1-tag-drawer-head {
        padding-top: 15px;
      }
      .dcv1-tag-drawer-handle {
        position: absolute;
        top: 6px;
        left: 50%;
        width: 34px;
        height: 3px;
        display: block;
        border-radius: 999px;
        background: rgba(246, 200, 76, .52);
        transform: translateX(-50%);
      }
      .dcv1-tag-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .dcv1-tag-tools {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .dcv1-tag-view-toggle {
        grid-column: 1 / -1;
        width: 100%;
      }
      .dcv1-tag-view-toggle button {
        flex: 1 1 50%;
      }
      .dcv1-creator-page { padding: 10px; }
      .dcv1-creator-hero {
        grid-template-columns: 76px minmax(0, 1fr);
        gap: 12px;
        padding: 14px;
      }
      .dcv1-profile-avatar {
        width: 76px;
        height: 76px;
        border-radius: 18px;
      }
      .dcv1-profile-title { font-size: 23px; }
      .dcv1-creator-hero .dcv1-creator-stat-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .dcv1-stat { min-width: 68px; padding: 6px 8px; }
      .dcv1-creator-about,
      .dcv1-creator-catalog {
        padding: 13px;
      }
      .dcv1-modal-layer {
        padding: 0;
      }
      .dcv1-character-modal {
        width: 100vw;
        height: 100dvh;
        max-height: none;
        border: 0;
        border-radius: 0;
      }
      .dcv1-character-modal-body {
        display: block;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      .dcv1-character-hero {
        height: min(40vh, 360px);
      }
      .dcv1-character-info {
        overflow: visible;
        padding: 17px;
      }
      .dcv1-local-hero {
        height: min(58vh, 540px);
        min-height: 250px;
        border-radius: 10px;
      }
      .dcv1-import-tray {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .dcv1-import-actions {
        grid-column: 1 / -1;
        justify-content: flex-end;
      }
      .dcv1-import-row {
        grid-template-columns: 36px minmax(0, 1fr) auto;
        gap: 6px;
        padding: 4px;
      }
      .dcv1-import-row-avatar {
        width: 36px;
        height: 42px;
      }
      .dcv1-import-row-actions {
        grid-column: auto;
        justify-content: initial;
        gap: 3px;
      }
      .dcv1-native-launch {
        width: 42px;
        height: 42px;
        flex-basis: 42px;
        padding: 11px;
      }
      .dcv1-native-launch[data-active="true"] {
        color: #f6c84c !important;
        box-shadow: inset 0 -3px 0 #f6c84c;
      }
    }
  `);

  tab.root.classList.add("dcv1-drawer-root");
  const root = document.createElement("section");
  root.className = "dcv1-root";
  root.innerHTML = `
    <header class="dcv1-toolbar">
      <div class="dcv1-toolbar-copy">
        <span class="dcv1-toolbar-brand">Datacat Browser</span>
        <span class="dcv1-version-badge">v${DISPLAY_VERSION}</span>
      </div>
      <button class="dcv1-button dcv1-toolbar-icon dcv1-toolbar-bare" type="button" data-refresh aria-label="Refresh Datacat" title="Refresh Datacat">${REFRESH_ICON}</button>
      <button class="dcv1-button dcv1-toolbar-close dcv1-toolbar-bare" type="button" data-close-drawer aria-label="Close Datacat">×</button>
      <div class="dcv1-status" data-status>Connecting…</div>
    </header>
    <nav class="dcv1-view-tabs" aria-label="Datacat browser view">
      <button class="dcv1-view-tab" type="button" data-view-mode="fresh" data-active="true">Fresh</button>
      <button class="dcv1-view-tab" type="button" data-view-mode="catalog" data-active="false">Catalog</button>
      <button class="dcv1-view-tab" type="button" data-view-mode="imports" data-active="false">Imports</button>
      <button class="dcv1-button dcv1-tag-toggle" type="button" data-tags-toggle aria-expanded="false">Tags</button>
    </nav>
    <div class="dcv1-search-row" data-search-row>
      <div class="dcv1-search-shell">
        <input class="dcv1-search" type="search" placeholder="Search characters, creators, or tags" autocomplete="off" data-search>
        <button class="dcv1-search-clear" type="button" data-clear hidden aria-label="Clear search" title="Clear search">×</button>
      </div>
      <div class="dcv1-catalog-sort" data-catalog-sort>
        <button class="dcv1-sort-trigger" type="button" data-sort-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Sort catalog">
          <span class="dcv1-sort-badge" data-sort-badge>Latest</span>
          <span class="dcv1-sort-spinner" data-sort-spinner hidden aria-hidden="true"></span>
          ${SORT_ICON}
        </button>
        <div class="dcv1-sort-menu" data-sort-menu role="menu" aria-label="Sort catalog" hidden>
          ${CATALOG_SORT_OPTIONS.map((option) => `<button class="dcv1-sort-option" type="button" data-sort-option="${escapeAttribute(option.value)}" role="menuitemradio">${escapeHtml(option.label)}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="dcv1-filter-chips" data-filter-chips hidden></div>
    <button class="dcv1-tag-scrim" type="button" data-tag-scrim data-tags-close aria-label="Close tag browser"></button>
    <aside class="dcv1-tag-panel" data-tag-panel data-open="false" aria-hidden="true" aria-label="Browse Datacat tags">
      <header class="dcv1-tag-drawer-head">
        <span class="dcv1-tag-drawer-handle" aria-hidden="true"></span>
        <div class="dcv1-tag-drawer-title">Browse tags<span>Choose multiple tags to narrow the catalog</span></div>
        <button class="dcv1-button" type="button" data-tags-close>Close</button>
      </header>
      <div class="dcv1-tag-tools">
        <input class="dcv1-search" type="search" placeholder="Find tags" autocomplete="off" data-tag-search>
        <button class="dcv1-button" type="button" data-tag-sort>Most used</button>
        <div class="dcv1-tag-view-toggle" role="group" aria-label="Tag view">
          <button type="button" data-tag-view="list">List</button>
          <button type="button" data-tag-view="cloud">Cloud</button>
        </div>
      </div>
      <div class="dcv1-tag-groups" data-tag-groups></div>
      <footer class="dcv1-tag-panel-footer">
        <span data-tag-status>Loading tags…</span>
      </footer>
    </aside>
    <div class="dcv1-scroll" data-catalog-scroll>
      <div class="dcv1-grid" data-grid></div>
      <button class="dcv1-infinite-sentinel" type="button" data-catalog-sentinel hidden></button>
    </div>
    <footer class="dcv1-account-footer">
      <span class="dcv1-account-summary" data-account-summary aria-busy="true"><span data-account-summary-label>Checking account…</span><span class="dcv1-inline-spinner" data-account-summary-spinner aria-hidden="true"></span></span>
      <div class="dcv1-menu dcv1-account-menu">
        <button class="dcv1-account-change" type="button" data-menu-toggle aria-label="Manage Datacat account" title="Manage Datacat account" aria-haspopup="menu" aria-expanded="false">${ACCOUNT_ICON}</button>
        <div class="dcv1-menu-panel" data-menu-panel role="menu" hidden></div>
      </div>
    </footer>
    <aside class="dcv1-import-tray" data-import-tray hidden role="status" aria-live="polite"></aside>
    <div data-profile></div>
  `;
  tab.root.replaceChildren(root);
  const modalHost = document.createElement("div");
  modalHost.className = "dcv1-page-modal-host";
  modalHost.dataset.open = "false";
  modalHost.setAttribute("aria-hidden", "true");
  document.body.append(modalHost);

  const grid = root.querySelector("[data-grid]");
  const searchRow = root.querySelector("[data-search-row]");
  const viewModeButtons = [
    ...root.querySelectorAll("[data-view-mode]"),
  ];
  const search = root.querySelector("[data-search]");
  const searchClear = root.querySelector("[data-clear]");
  const catalogSortToggle = root.querySelector("[data-sort-toggle]");
  const catalogSortBadgeEl = root.querySelector("[data-sort-badge]");
  const catalogSortSpinner = root.querySelector("[data-sort-spinner]");
  const catalogSortMenu = root.querySelector("[data-sort-menu]");
  const tagsToggle = root.querySelector("[data-tags-toggle]");
  const filterChips = root.querySelector("[data-filter-chips]");
  const tagScrim = root.querySelector("[data-tag-scrim]");
  const tagPanel = root.querySelector("[data-tag-panel]");
  const tagSearch = root.querySelector("[data-tag-search]");
  const tagGroups = root.querySelector("[data-tag-groups]");
  const tagStatus = root.querySelector("[data-tag-status]");
  const tagSort = root.querySelector("[data-tag-sort]");
  const tagViewButtons = [
    ...root.querySelectorAll("[data-tag-view]"),
  ];
  const status = root.querySelector("[data-status]");
  const catalogScroll = root.querySelector("[data-catalog-scroll]");
  const catalogSentinel = root.querySelector("[data-catalog-sentinel]");
  const accountSummary = root.querySelector("[data-account-summary]");
  const accountSummaryLabel = root.querySelector("[data-account-summary-label]");
  const accountSummarySpinner = root.querySelector("[data-account-summary-spinner]");
  const menuToggle = root.querySelector("[data-menu-toggle]");
  const menuPanel = root.querySelector("[data-menu-panel]");
  const importTray = root.querySelector("[data-import-tray]");
  const profileHost = root.querySelector("[data-profile]");

  function readPersistedBrowserState() {
    try {
      const parsed = JSON.parse(
        sessionStorage.getItem(BROWSER_STATE_KEY) || "null",
      );
      return parsed?.schema === 1 && typeof parsed === "object"
        ? parsed
        : null;
    } catch (_) {
      return null;
    }
  }

  const persistedBrowserState = readPersistedBrowserState();
  const persistedViewMode = ["fresh", "catalog"].includes(
    persistedBrowserState?.viewMode,
  )
    ? persistedBrowserState.viewMode
    : "fresh";
  const persistedCreatorRef = String(
    persistedBrowserState?.selectedCreatorRef || "",
  ).trim();

  const state = {
    initializing: true,
    viewMode: persistedViewMode,
    characters: [],
    query: String(persistedBrowserState?.query || "").slice(0, 120),
    catalogSort: normalizeCatalogSort(persistedBrowserState?.catalogSort),
    catalogSortLoading: false,
    offset: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: "",
    loadMoreError: "",
    freshWindows: {
      last24h: [],
      thisWeek: [],
    },
    freshPaging: {
      last24h: { nextOffset: 0, hasMore: false },
      thisWeek: { nextOffset: 0, hasMore: false },
    },
    freshLoading: false,
    freshLoadingMore: false,
    freshError: "",
    freshLoadMoreError: "",
    freshSerial: 0,
    community: null,
    communityCharacterId: "",
    communityLoading: false,
    communityError: "",
    communitySubmitting: "",
    communityKudosOpen: false,
    communityComposerOpen: false,
    communityDraft: "",
    communitySerial: 0,
    selected: null,
    selectedLoading: false,
    selectedError: "",
    cardCache: new Map(),
    cardErrors: new Map(),
    cardTabChoice: new Map(),
    cardLoading: new Set(),
    verificationDeclined: false,
    selectedSerial: 0,
    selectedCreator: null,
    selectedCreatorRef: persistedCreatorRef,
    creatorCharacters: [],
    creatorOffset: 0,
    creatorHasMore: false,
    creatorLoading: false,
    creatorLoadingMore: false,
    creatorError: "",
    creatorTagSlugs: new Set(),
    tags: [],
    tagGroups: [],
    selectedTagIds: new Set(
      Array.isArray(persistedBrowserState?.selectedTagIds)
        ? persistedBrowserState.selectedTagIds
            .map(Number)
            .filter((id) => Number.isFinite(id) && id > 0)
        : [],
    ),
    tagPanelOpen: persistedBrowserState?.tagPanelOpen === true,
    tagQuery: String(persistedBrowserState?.tagQuery || "").slice(0, 80),
    tagSort: persistedBrowserState?.tagSort === "alpha" ? "alpha" : "count",
    tagView:
      persistedBrowserState?.tagView === "list"
        ? "list"
        : loadTagViewMode(),
    tagOffset: 0,
    tagTotal: 0,
    tagHasMore: false,
    tagLoading: false,
    tagLoadingMore: false,
    tagError: "",
    tagSerial: 0,
    importId: "",
    chatOpeningId: "",
    importFeedback: null,
    linkedAccount: null,
    accountState: "loading",
    accountLinking: false,
    accountChoiceOpen: false,
    savedCharacters: new Map(),
    imports: [],
    savedLoaded: false,
    savedLoading: false,
    savedError: "",
    savedLoadedAt: 0,
    serial: 0,
  };
  let searchTimer = 0;
  let tagSearchTimer = 0;
  let linkPollTimer = 0;
  let verificationPollTimer = 0;
  let verificationPromise = null;
  let verificationReject = null;
  let activeVerificationPopup = null;
  let verificationGeneration = 0;
  let accountStatePromise = null;
  let accountLoadedAt = 0;
  let modalReturnFocus = null;
  let browserStateSaveTimer = 0;
  let pendingCatalogScrollTop = Number.isFinite(
    Number(persistedBrowserState?.scrollTop),
  )
    ? Math.max(0, Number(persistedBrowserState.scrollTop))
    : null;
  const pendingCreatorRef = persistedCreatorRef;
  let localCharacterModal = null;
  let localCharacterModalSerial = 0;
  search.value = state.query;
  tagSearch.value = state.tagQuery;

  function persistBrowserStateNow() {
    try {
      sessionStorage.setItem(
        BROWSER_STATE_KEY,
        JSON.stringify({
          schema: 1,
          savedAt: Date.now(),
          viewMode: state.viewMode,
          query: state.query,
          catalogSort: state.catalogSort,
          selectedTagIds: [...state.selectedTagIds],
          tagPanelOpen: state.tagPanelOpen,
          tagQuery: state.tagQuery,
          tagSort: state.tagSort,
          tagView: state.tagView,
          selectedCreatorRef: state.selectedCreatorRef,
          scrollTop:
            pendingCatalogScrollTop ?? catalogScroll.scrollTop,
        }),
      );
    } catch (_) {}
  }

  function scheduleBrowserStateSave() {
    window.clearTimeout(browserStateSaveTimer);
    browserStateSaveTimer = window.setTimeout(() => {
      browserStateSaveTimer = 0;
      persistBrowserStateNow();
    }, 80);
  }

  function restorePersistedScroll() {
    if (pendingCatalogScrollTop === null) return;
    requestAnimationFrame(() => {
      const maximum = Math.max(
        0,
        catalogScroll.scrollHeight - catalogScroll.clientHeight,
      );
      catalogScroll.scrollTop = Math.min(
        pendingCatalogScrollTop,
        maximum,
      );
      if (maximum >= pendingCatalogScrollTop - 1) {
        pendingCatalogScrollTop = null;
        scheduleBrowserStateSave();
      }
    });
  }

  const catalogObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (state.viewMode === "fresh") {
        if (
          freshHasMore() &&
          !state.freshLoading &&
          !state.freshLoadingMore &&
          !state.freshError &&
          !state.freshLoadMoreError
        ) {
          void loadFreshCharacters();
        }
        return;
      }
      if (
        state.hasMore &&
        !state.loading &&
        !state.loadingMore &&
        !state.error &&
        !state.loadMoreError
      ) {
        void loadCharacters();
      }
    },
    {
      root: catalogScroll,
      rootMargin: "700px 0px",
    },
  );
  const tagObserver = new IntersectionObserver(
    (entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        state.tagPanelOpen &&
        state.tagHasMore &&
        !state.tagLoading &&
        !state.tagLoadingMore &&
        !state.tagError
      ) {
        void loadTags();
      }
    },
    {
      root: tagGroups,
      rootMargin: "320px 0px",
    },
  );
  const creatorObserver = new IntersectionObserver(
    (entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        state.selectedCreatorRef &&
        state.creatorHasMore &&
        !state.creatorLoading &&
        !state.creatorLoadingMore &&
        !state.creatorError
      ) {
        void loadCreatorCharacters();
      }
    },
    {
      root: null,
      rootMargin: "700px 0px",
    },
  );
  const pendingLinkIndexRequests = new Map();
  datacatBackendRequest = (operation, request = {}) =>
    new Promise((resolve, reject) => {
      const requestId = uuidv7();
      const timer = window.setTimeout(() => {
        pendingLinkIndexRequests.delete(requestId);
        reject(new Error("The secure Lumiverse Datacat bridge timed out."));
      }, 35_000);
      pendingLinkIndexRequests.set(requestId, { resolve, reject, timer });
      if (operation === "api") {
        ctx.sendToBackend({
          type: "datacat_api_request",
          requestId,
          request,
        });
      } else if (operation === "state") {
        ctx.sendToBackend({ type: "datacat_secure_state_request", requestId });
      } else if (operation === "clear-verification") {
        ctx.sendToBackend({
          type: "datacat_clear_verification_request",
          requestId,
        });
      } else {
        window.clearTimeout(timer);
        pendingLinkIndexRequests.delete(requestId);
        reject(new Error("Unsupported secure Datacat bridge operation."));
      }
    });
  const stopBackendMessages = ctx.onBackendMessage((payload) => {
    if (
      !payload ||
      ![
        "datacat_link_index_result",
        "datacat_link_index_error",
        "datacat_character_link_result",
        "datacat_character_link_error",
        "datacat_api_result",
        "datacat_api_error",
        "datacat_secure_state_result",
        "datacat_secure_state_error",
        "datacat_clear_verification_result",
        "datacat_clear_verification_error",
      ].includes(payload.type)
    ) {
      return;
    }
    const pending = pendingLinkIndexRequests.get(
      String(payload.requestId || ""),
    );
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingLinkIndexRequests.delete(String(payload.requestId || ""));
    if (
      [
        "datacat_link_index_error",
        "datacat_character_link_error",
        "datacat_api_error",
        "datacat_secure_state_error",
        "datacat_clear_verification_error",
      ].includes(payload.type)
    ) {
      pending.reject(
        new Error(
          String(
            payload.error ||
              "Could not inspect the Lumiverse character library.",
          ),
        ),
      );
      return;
    }
    if (payload.type === "datacat_api_result") {
      pending.resolve(payload.response || {});
    } else if (payload.type === "datacat_secure_state_result") {
      pending.resolve(payload.state || {});
    } else {
      pending.resolve(payload);
    }
  });

  async function ensureSecureTransportPermission() {
    const granted = await ctx.permissions.getGranted();
    if (granted.includes("cors_proxy")) return true;
    const next = await ctx.permissions.request(
      ["cors_proxy"],
      {
        reason: "Connect securely to Datacat.",
      },
    );
    return next.includes("cors_proxy");
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.style.color = error ? "#ff9da8" : "";
  }

  function setMenuOpen(open) {
    const next = open === true;
    if (!next) state.accountChoiceOpen = false;
    menuPanel.hidden = !next;
    menuToggle.setAttribute("aria-expanded", String(next));
    if (next) {
      menuPanel.querySelector("button")?.focus();
    }
  }

  function setCatalogSortOpen(open) {
    const next = open === true;
    catalogSortMenu.hidden = !next;
    catalogSortToggle.setAttribute("aria-expanded", String(next));
    if (next) {
      catalogSortMenu.querySelector('[data-active="true"]')?.focus();
    }
  }

  function syncCatalogSortControl() {
    const option = catalogSortOption(state.catalogSort);
    const loading = state.catalogSortLoading === true;
    catalogSortBadgeEl.textContent = catalogSortBadge(state.catalogSort);
    catalogSortSpinner.hidden = !loading;
    catalogSortToggle.dataset.loading = String(loading);
    catalogSortToggle.disabled = loading;
    catalogSortToggle.setAttribute("aria-busy", String(loading));
    catalogSortToggle.title = loading
      ? `Loading ${option.label}…`
      : `Sort: ${option.label}`;
    catalogSortToggle.setAttribute(
      "aria-label",
      loading
        ? `Loading catalog sorted by ${option.label}`
        : `Sort catalog: ${option.label}`,
    );
    for (const button of catalogSortMenu.querySelectorAll("[data-sort-option]")) {
      const active = button.getAttribute("data-sort-option") === option.value;
      button.dataset.active = String(active);
      button.setAttribute("aria-checked", String(active));
      button.disabled = loading;
    }
  }

  function observeCreatorSentinel() {
    creatorObserver.disconnect();
    const sentinel = profileHost.querySelector("[data-creator-sentinel]");
    if (sentinel && state.creatorHasMore) {
      creatorObserver.observe(sentinel);
    }
  }

  function observeTagSentinel() {
    tagObserver.disconnect();
    const sentinel = tagGroups.querySelector("[data-tag-sentinel]");
    if (sentinel && state.tagPanelOpen && state.tagHasMore) {
      tagObserver.observe(sentinel);
    }
  }

  function tagById(tagId) {
    const id = Number(tagId);
    return state.tags.find((tag) => Number(tag.id) === id) || null;
  }

  function selectedTags() {
    return [...state.selectedTagIds]
      .map(tagById)
      .filter(Boolean);
  }

  function syncTagPanelVisibility() {
    tagPanel.dataset.open = String(state.tagPanelOpen);
    tagPanel.setAttribute("aria-hidden", String(!state.tagPanelOpen));
    tagScrim.dataset.open = String(state.tagPanelOpen);
    tagsToggle.dataset.active = String(
      state.tagPanelOpen || state.selectedTagIds.size > 0,
    );
    tagsToggle.setAttribute("aria-expanded", String(state.tagPanelOpen));
    tagsToggle.textContent = state.selectedTagIds.size
      ? `Tags (${state.selectedTagIds.size})`
      : "Tags";
  }

  function renderTagBrowser() {
    const previousScrollTop = tagGroups.scrollTop;
    syncTagPanelVisibility();
    const selected = selectedTags();
    filterChips.hidden =
      state.viewMode !== "catalog" || selected.length === 0;
    filterChips.innerHTML = selected.length
      ? `${selected
          .map(
            (tag) => `
              <button class="dcv1-chip" type="button" data-tag-remove="${Number(tag.id)}" title="Remove ${escapeAttribute(tag.name)}">
                ${escapeHtml(tag.name)}
                <span aria-hidden="true">×</span>
              </button>`,
          )
          .join("")}
         <button class="dcv1-tag" type="button" data-tags-clear>Clear tags</button>`
      : "";
    tagSort.textContent =
      state.tagSort === "alpha" ? "A–Z" : "Most used";
    for (const button of tagViewButtons) {
      const active = button.dataset.tagView === state.tagView;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
    }
    tagStatus.textContent = state.tagError
      ? state.tagError
      : state.tagLoading && state.tags.length === 0
        ? "Loading tags…"
        : `${state.tags.length}${state.tagTotal > state.tags.length ? ` of ${state.tagTotal}` : ""} tags${state.tagLoadingMore ? " · loading more…" : ""}`;
    if (state.tagLoading && state.tags.length === 0) {
      tagGroups.innerHTML = `<div class="dcv1-empty">Loading Datacat tags…</div>`;
      tagObserver.disconnect();
      return;
    }
    if (state.tagError && state.tags.length === 0) {
      tagGroups.innerHTML = `
        <div class="dcv1-empty" data-error>
          ${escapeHtml(state.tagError)}
          <button class="dcv1-button" type="button" data-tag-retry>Retry</button>
        </div>`;
      tagObserver.disconnect();
      return;
    }
    const groupsById = new Map(
      state.tagGroups.map((group) => [Number(group.id), group]),
    );
    const buckets = new Map();
    for (const tag of state.tags) {
      const key = Number(tag.groupId) || 0;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(tag);
    }
    const ordered = [...buckets.entries()].sort(([a], [b]) => {
      const groupA = groupsById.get(a);
      const groupB = groupsById.get(b);
      return (
        Number(groupA?.displayOrder ?? 9999) -
          Number(groupB?.displayOrder ?? 9999) ||
        String(groupA?.name || "Other").localeCompare(
          String(groupB?.name || "Other"),
        )
      );
    });
    let content = "";
    if (state.tagView === "cloud" && state.tags.length > 0) {
      const cloudTags = [...state.tags].sort((a, b) => {
        const selectedDelta =
          Number(state.selectedTagIds.has(Number(b.id))) -
          Number(state.selectedTagIds.has(Number(a.id)));
        if (selectedDelta) return selectedDelta;
        return state.tagSort === "alpha"
          ? String(a.name || "").localeCompare(String(b.name || ""))
          : Number(b.count || 0) - Number(a.count || 0) ||
              String(a.name || "").localeCompare(String(b.name || ""));
      });
      const maxCount = Math.max(
        1,
        ...cloudTags.map((tag) => Number(tag.count || 0)),
      );
      content = `
        <div class="dcv1-tag-cloud">
          ${cloudTags
            .map((tag) => {
              const heat = Math.max(
                0,
                Math.min(1, Number(tag.count || 0) / maxCount),
              ).toFixed(3);
              return `
                <button class="dcv1-tag-cloud-item" type="button" data-tag-id="${Number(tag.id)}" data-selected="${state.selectedTagIds.has(Number(tag.id))}" style="--heat:${heat}">
                  <span>${escapeHtml(tag.name)}</span>
                  <span class="dcv1-tag-count">${compactNumber(tag.count)}</span>
                </button>`;
            })
            .join("")}
        </div>`;
    } else if (ordered.length > 0) {
      content = ordered
        .map(([groupId, tags]) => {
          const group = groupsById.get(groupId);
          return `
            <section class="dcv1-tag-group">
              <div class="dcv1-tag-group-title">${escapeHtml(group?.name || "Other")}</div>
              <div class="dcv1-tag-list">
                ${tags
                  .map(
                    (tag) => `
                      <button class="dcv1-tag" type="button" data-tag-id="${Number(tag.id)}" data-selected="${state.selectedTagIds.has(Number(tag.id))}">
                        <span>${escapeHtml(tag.name)}</span>
                        <span class="dcv1-tag-count">${compactNumber(tag.count)}</span>
                      </button>`,
                  )
                  .join("")}
              </div>
            </section>`;
        })
        .join("");
    } else {
      content = `<div class="dcv1-empty">No matching tags.</div>`;
    }
    if (state.tagHasMore) {
      content += `
        <button class="dcv1-tag-infinite-sentinel" type="button" data-tag-sentinel ${state.tagError && !state.tagLoadingMore ? "" : "disabled"}>
          ${state.tagLoadingMore
            ? "Loading more tags…"
            : state.tagError
              ? "Could not load more tags. Tap to retry."
              : "Scroll for more tags"}
        </button>`;
    }
    tagGroups.innerHTML = content;
    tagGroups.scrollTop = previousScrollTop;
    requestAnimationFrame(observeTagSentinel);
  }

  function renderImportFeedback() {
    const feedback = state.importFeedback;
    if (!feedback) {
      importTray.hidden = true;
      importTray.replaceChildren();
      importTray.removeAttribute("data-tone");
      return;
    }
    const tone = ["success", "error", "verification"].includes(feedback.tone)
      ? feedback.tone
      : "progress";
    const icon = tone === "progress"
      ? '<span class="dcv1-import-spinner" aria-hidden="true"></span>'
      : tone === "success"
        ? "✓"
        : tone === "verification"
          ? "↗"
          : "!";
    const actions = tone === "success" && feedback.lumiverseCharacterId
      ? `
          <button class="dcv1-button" data-primary type="button" data-chat-import="${escapeAttribute(feedback.lumiverseCharacterId)}">Chat</button>
          <button class="dcv1-button dcv1-import-close" type="button" data-dismiss-import aria-label="Close import confirmation" title="Close">×</button>
        `
      : tone === "error"
        ? `
            ${feedback.lumiverseCharacterId
              ? `<button class="dcv1-button" data-primary type="button" data-view-import="${escapeAttribute(feedback.lumiverseCharacterId)}">View character</button>`
              : feedback.datacatCharacterId
                ? `<button class="dcv1-button" data-primary type="button" data-retry-import="${escapeAttribute(feedback.datacatCharacterId)}">${escapeHtml(feedback.retryLabel || "Try again")}</button>`
                : ""}
            <button class="dcv1-button" type="button" data-dismiss-import>Dismiss</button>
          `
        : "";
    importTray.dataset.tone = tone;
    importTray.innerHTML = `
      <div class="dcv1-import-icon">${icon}</div>
      <div class="dcv1-import-copy">
        <div class="dcv1-import-title">${escapeHtml(feedback.title)}</div>
        ${feedback.detail ? `<div class="dcv1-import-detail">${escapeHtml(feedback.detail)}</div>` : ""}
      </div>
      ${actions ? `<div class="dcv1-import-actions">${actions}</div>` : ""}
    `;
    importTray.hidden = false;
  }

  function setImportFeedback(feedback) {
    state.importFeedback = feedback;
    renderImportFeedback();
  }

  function savedLumiverseId(datacatCharacterId) {
    return state.savedCharacters.get(normalizeId(datacatCharacterId)) || "";
  }

  function importRecordTimestamp(record) {
    const timestamp = Date.parse(String(record?.importedAt || ""));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function normalizeImportRecord(link = {}) {
    const datacatCharacterId = normalizeId(link?.datacatCharacterId);
    const lumiverseCharacterId = normalizeId(link?.lumiverseCharacterId);
    if (!datacatCharacterId || !lumiverseCharacterId) return null;
    const importedAt = String(link?.importedAt || "").trim();
    return {
      datacatCharacterId,
      lumiverseCharacterId,
      name: String(link?.name || "Imported character").trim() || "Imported character",
      importedAt: Number.isFinite(Date.parse(importedAt)) ? importedAt : "",
    };
  }

  function setImportRecords(links = []) {
    state.imports = (Array.isArray(links) ? links : [])
      .map(normalizeImportRecord)
      .filter(Boolean)
      .sort(
        (left, right) =>
          importRecordTimestamp(right) - importRecordTimestamp(left),
      );
  }

  function upsertImportRecord(record = {}) {
    const normalized = normalizeImportRecord(record);
    if (!normalized) return;
    setImportRecords([
      normalized,
      ...state.imports.filter(
        (item) =>
          item.datacatCharacterId !== normalized.datacatCharacterId &&
          item.lumiverseCharacterId !== normalized.lumiverseCharacterId,
      ),
    ]);
  }

  function findCharacterById(id) {
    const normalized = normalizeId(id);
    return (
      state.characters.find((row) => normalizeId(row.id) === normalized) ||
      state.freshWindows.last24h.find(
        (row) => normalizeId(row.id) === normalized,
      ) ||
      state.freshWindows.thisWeek.find(
        (row) => normalizeId(row.id) === normalized,
      ) ||
      state.creatorCharacters.find(
        (row) => normalizeId(row.id) === normalized,
      ) ||
      (normalizeId(state.selected?.id) === normalized
        ? state.selected
        : null)
    );
  }

  function updateCatalogStatus() {
    if (state.viewMode === "fresh") {
      updateFreshStatus();
      return;
    }
    if (state.viewMode === "imports") {
      setStatus(state.savedError || "", Boolean(state.savedError));
      return;
    }
    if (state.error) return;
    setStatus(
      state.savedError ? "Added-card check unavailable." : "",
      Boolean(state.savedError),
    );
  }

  function updateFreshStatus() {
    if (state.freshError) return;
    setStatus(
      state.savedError ? "Added-card check unavailable." : "",
      Boolean(state.savedError),
    );
  }

  function localCharacterAvatarUrl(character) {
    const imageId = normalizeId(character?.image_id);
    if (imageId) {
      return `/api/v1/images/${encodeURIComponent(imageId)}?size=lg`;
    }
    const characterId = normalizeId(character?.id);
    return characterId
      ? `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=lg`
      : "";
  }

  function renderImportRow(record) {
    const name = String(record?.name || "Imported character");
    const lumiverseCharacterId = normalizeId(record?.lumiverseCharacterId);
    const importedAt = String(record?.importedAt || "").trim();
    const timing = importedAt ? relativeTime(importedAt) : "Imported";
    return `
      <article class="dcv1-import-row">
        <div class="dcv1-import-row-avatar">
          <img src="${escapeAttribute(localCharacterAvatarUrl({ id: lumiverseCharacterId }))}" alt="" loading="lazy">
        </div>
        <div class="dcv1-import-row-copy">
          <div class="dcv1-import-row-title" title="${escapeAttribute(name)}">${escapeHtml(name)}</div>
          <div class="dcv1-import-row-time">${escapeHtml(timing)}</div>
        </div>
        <div class="dcv1-import-row-actions">
          <button class="dcv1-button" type="button" data-view-import="${escapeAttribute(lumiverseCharacterId)}">View</button>
          <button class="dcv1-button" data-primary type="button" data-chat-import="${escapeAttribute(lumiverseCharacterId)}">Chat</button>
        </div>
      </article>`;
  }

  function renderImports() {
    if (state.savedLoading && state.imports.length === 0) {
      return renderLoadingState("Loading imports…");
    }
    if (state.savedError && state.imports.length === 0) {
      return `<div class="dcv1-empty" data-error>${escapeHtml(state.savedError)}</div>`;
    }
    if (state.imports.length === 0) {
      return '<div class="dcv1-empty">No imports yet.</div>';
    }
    return `
      <section class="dcv1-imports">
        <header class="dcv1-imports-head">
          <strong>Latest imports</strong>
          <span>${state.imports.length} imported</span>
        </header>
        <div class="dcv1-import-list">
          ${state.imports.map(renderImportRow).join("")}
        </div>
      </section>`;
  }

  function renderLocalCharacterSection(title, value) {
    const content = String(value || "").trim();
    return `
      <details class="dcv1-local-section">
        <summary>${escapeHtml(title)}</summary>
        <div class="dcv1-local-section-copy">
          ${content
            ? escapeHtml(content)
            : '<span class="dcv1-local-empty">No content.</span>'}
        </div>
      </details>`;
  }

  function closeLocalCharacterModal() {
    localCharacterModalSerial += 1;
    localCharacterModal?.dismiss();
    localCharacterModal = null;
  }

  function showSafeModal(options) {
    const modal = ctx.ui.showModal(options);
    // Lumiverse exposes this host-level variable for the iOS safe area and
    // desktop window-controls overlay. showModal's chrome does not yet apply
    // it, so reserve that space on the backdrop that owns the header.
    const modalBody = modal.root.parentElement;
    const modalContainer = modalBody?.parentElement;
    const modalBackdrop = modalContainer?.parentElement;
    if (
      !(modalContainer instanceof HTMLElement) ||
      !(modalBackdrop instanceof HTMLElement)
    ) {
      return modal;
    }

    const safeTop =
      "var(--app-interactive-safe-top, env(safe-area-inset-top, 0px))";
    const safeBottom = "env(safe-area-inset-bottom, 0px)";
    const safeLeft = "env(safe-area-inset-left, 0px)";
    const safeRight = "env(safe-area-inset-right, 0px)";
    Object.assign(modalBackdrop.style, {
      paddingTop: `calc(20px + ${safeTop})`,
      paddingRight: `calc(20px + ${safeRight})`,
      paddingBottom: `calc(20px + ${safeBottom})`,
      paddingLeft: `calc(20px + ${safeLeft})`,
    });
    modalContainer.style.maxHeight = `min(${modalContainer.style.maxHeight || "100%"}, 100%)`;
    return modal;
  }

  async function openLocalCharacterModal(characterId) {
    const id = normalizeId(characterId);
    if (!id) return;
    closeLocalCharacterModal();
    const serial = ++localCharacterModalSerial;
    const modal = showSafeModal({
      title: "Lumiverse Character",
      width: 760,
      maxHeight: Math.max(420, window.innerHeight - 32),
    });
    localCharacterModal = modal;
    modal.root.innerHTML = `
      <div class="dcv1-empty">Loading Lumiverse character…</div>`;
    modal.onDismiss(() => {
      if (localCharacterModal === modal) localCharacterModal = null;
      localCharacterModalSerial += 1;
    });
    try {
      const character = await ctx.characters.get(id);
      if (
        serial !== localCharacterModalSerial ||
        localCharacterModal !== modal
      ) {
        return;
      }
      const name = String(character?.name || "Lumiverse Character");
      const creator = String(character?.creator || "").trim();
      const avatarUrl = localCharacterAvatarUrl(character);
      const tags = Array.isArray(character?.tags)
        ? character.tags.map(String).filter(Boolean)
        : [];
      modal.setTitle(name);
      modal.root.innerHTML = `
        <article class="dcv1-local-profile">
          <section class="dcv1-local-hero">
            <div class="dcv1-local-avatar-fallback" aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
            ${avatarUrl
              ? `<img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(name)}">`
              : ""}
            <div class="dcv1-local-hero-copy">
              <h3>${escapeHtml(name)}</h3>
              ${creator
                ? `<div class="dcv1-local-creator">By ${escapeHtml(creator)}</div>`
                : ""}
              ${tags.length
                ? `<div class="dcv1-local-tags">${tags
                    .map(
                      (tag) => `<span class="dcv1-local-tag">${escapeHtml(tag)}</span>`,
                    )
                    .join("")}</div>`
                : ""}
            </div>
          </section>
          ${renderLocalCharacterSection("Description", character?.description)}
          ${renderLocalCharacterSection("Personality", character?.personality)}
          ${renderLocalCharacterSection("Scenario", character?.scenario)}
          ${renderLocalCharacterSection("First Message", character?.first_mes)}
          ${renderLocalCharacterSection("System Prompt", character?.system_prompt)}
        </article>`;
      const image = modal.root.querySelector(".dcv1-local-hero img");
      image?.addEventListener("error", () => image.remove(), { once: true });
    } catch (error) {
      if (
        serial !== localCharacterModalSerial ||
        localCharacterModal !== modal
      ) {
        return;
      }
      modal.root.innerHTML = `
        <div class="dcv1-empty" data-error>
          ${escapeHtml(publicErrorMessage(error, "Could not load this Lumiverse character."))}
        </div>`;
    }
  }

  function navigateLumiverseChatInPlace(chatId) {
    const id = normalizeId(chatId);
    if (!id) throw new Error("Lumiverse returned no usable chat.");
    const target = `/chat/${encodeURIComponent(id)}`;
    persistBrowserStateNow();
    if (window.location.pathname === target) return;

    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    const currentIndex = Number(currentState.idx);
    window.history.pushState(
      {
        ...currentState,
        usr: null,
        key: Math.random().toString(36).slice(2, 10),
        idx: Number.isFinite(currentIndex) ? currentIndex + 1 : 1,
      },
      "",
      target,
    );
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  }

  async function createLumiverseChat(characterId, greetingIndex) {
    const body = { character_id: characterId };
    if (Number.isInteger(greetingIndex)) body.greeting_index = greetingIndex;
    const response = await fetch("/api/v1/chats", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const chat = await readJson(response);
    const chatId = normalizeId(chat?.id);
    if (!chatId) throw new Error("Lumiverse returned no usable chat.");
    return chatId;
  }

  function localChatDate(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "";
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  async function startNewLumiverseChat(characterId) {
    const character = await ctx.characters.get(characterId);
    const alternates = Array.isArray(character?.alternate_greetings)
      ? character.alternate_greetings
      : [];
    if (alternates.length > 0) {
      showLumiverseGreetingPicker(characterId, character, alternates);
      return;
    }
    const chatId = await createLumiverseChat(characterId);
    navigateLumiverseChatInPlace(chatId);
  }

  function showLumiverseGreetingPicker(characterId, character, alternates) {
    const greetings = [
      {
        label: "Default greeting",
        content: String(character?.first_mes || ""),
      },
      ...alternates.map((content, index) => ({
        label: `Greeting ${index + 2}`,
        content: String(content || ""),
      })),
    ];
    const modal = showSafeModal({
      title: "Choose a greeting",
      width: 620,
      maxHeight: Math.max(420, Math.min(720, window.innerHeight - 32)),
    });
    modal.root.innerHTML = `
      <div class="dcv1-chat-picker">
        <p class="dcv1-chat-picker-count">${greetings.length} greetings</p>
        ${greetings
          .map(
            (greeting, index) => `
              <button class="dcv1-chat-choice" type="button" data-greeting-index="${index}">
                <span class="dcv1-chat-choice-head">
                  <span class="dcv1-chat-choice-label">${escapeHtml(greeting.label)}</span>
                </span>
                <span class="dcv1-chat-choice-preview">${escapeHtml(greeting.content)}</span>
              </button>`,
          )
          .join("")}
        <div class="dcv1-chat-picker-error" data-chat-picker-error></div>
      </div>`;
    modal.root.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-greeting-index]");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      const greetingIndex = Number(button.dataset.greetingIndex);
      if (!Number.isInteger(greetingIndex)) return;
      const buttons = [...modal.root.querySelectorAll("button")];
      buttons.forEach((item) => { item.disabled = true; });
      button.dataset.loading = "true";
      const errorHost = modal.root.querySelector("[data-chat-picker-error]");
      if (errorHost) errorHost.textContent = "Creating chat…";
      try {
        const chatId = await createLumiverseChat(characterId, greetingIndex);
        modal.dismiss();
        navigateLumiverseChatInPlace(chatId);
      } catch (error) {
        const message = publicErrorMessage(error, "Could not create this Lumiverse chat.");
        if (errorHost) errorHost.textContent = message;
        buttons.forEach((item) => { item.disabled = false; });
        delete button.dataset.loading;
        sendNativeToast("error", message, "Lumiverse chat");
      }
    });
  }

  function showLumiverseChatPicker(characterId, characterName, chats) {
    const modal = showSafeModal({
      title: `Chats with ${characterName || "character"}`,
      width: 620,
      maxHeight: Math.max(420, Math.min(720, window.innerHeight - 32)),
    });
    modal.root.innerHTML = `
      <div class="dcv1-chat-picker">
        <p class="dcv1-chat-picker-count">Choose a conversation or start a new one.</p>
        <button class="dcv1-chat-choice" type="button" data-new-chat>
          <span class="dcv1-chat-choice-label">＋ New chat</span>
        </button>
        ${chats
          .map((chat, index) => {
            const name = String(chat?.name || "").trim() ||
              `Chat${localChatDate(chat?.created_at) ? ` from ${localChatDate(chat.created_at)}` : ""}`;
            const messageCount = Number(chat?.message_count);
            const meta = [
              Number.isFinite(messageCount)
                ? `${messageCount} message${messageCount === 1 ? "" : "s"}`
                : "",
              localChatDate(chat?.updated_at),
            ].filter(Boolean).join(" · ");
            return `
              <button class="dcv1-chat-choice" type="button" data-existing-chat="${escapeAttribute(chat?.id)}">
                <span class="dcv1-chat-choice-head">
                  <span class="dcv1-chat-choice-label">${escapeHtml(name)}</span>
                  ${index === 0 ? '<span class="dcv1-chat-choice-badge">Most recent</span>' : ""}
                </span>
                ${meta ? `<span class="dcv1-chat-choice-meta">${escapeHtml(meta)}</span>` : ""}
              </button>`;
          })
          .join("")}
        <div class="dcv1-chat-picker-error" data-chat-picker-error></div>
      </div>`;
    modal.root.addEventListener("click", async (event) => {
      const existing = event.target.closest("[data-existing-chat]");
      if (existing instanceof HTMLButtonElement) {
        const chatId = normalizeId(existing.dataset.existingChat);
        if (!chatId) return;
        modal.dismiss();
        navigateLumiverseChatInPlace(chatId);
        return;
      }
      const newChat = event.target.closest("[data-new-chat]");
      if (!(newChat instanceof HTMLButtonElement) || newChat.disabled) return;
      const buttons = [...modal.root.querySelectorAll("button")];
      buttons.forEach((item) => { item.disabled = true; });
      const errorHost = modal.root.querySelector("[data-chat-picker-error]");
      if (errorHost) errorHost.textContent = "Preparing a new chat…";
      try {
        const character = await ctx.characters.get(characterId);
        const alternates = Array.isArray(character?.alternate_greetings)
          ? character.alternate_greetings
          : [];
        if (alternates.length > 0) {
          modal.dismiss();
          showLumiverseGreetingPicker(characterId, character, alternates);
        } else {
          const chatId = await createLumiverseChat(characterId);
          modal.dismiss();
          navigateLumiverseChatInPlace(chatId);
        }
      } catch (error) {
        const message = publicErrorMessage(error, "Could not create this Lumiverse chat.");
        if (errorHost) errorHost.textContent = message;
        buttons.forEach((item) => { item.disabled = false; });
        sendNativeToast("error", message, "Lumiverse chat");
      }
    });
  }

  function setChatButtonLoading(button, loading) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (loading) {
      button.style.minWidth = `${Math.ceil(button.getBoundingClientRect().width)}px`;
    }
    button.disabled = loading;
    if (loading) {
      button.setAttribute("data-loading", "true");
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "Opening chat");
      button.textContent = "";
    } else {
      button.removeAttribute("data-loading");
      button.removeAttribute("aria-busy");
      button.removeAttribute("aria-label");
      button.style.removeProperty("min-width");
      button.textContent = "Chat";
    }
  }

  async function openOrCreateLumiverseChat(characterId, button) {
    const id = normalizeId(characterId);
    if (!id || state.chatOpeningId) return;
    const loadingStartedAt = performance.now();
    const closeDetailWhenReady = Boolean(
      button instanceof Element && button.closest(".dcv1-character-modal"),
    );
    let completed = false;
    state.chatOpeningId = id;
    setChatButtonLoading(button, true);
    try {
      const chatsResponse = await fetch(
        `/api/v1/chats/character-chats/${encodeURIComponent(id)}`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      );
      const chats = await readJson(chatsResponse);
      if (Array.isArray(chats) && chats.length > 1) {
        const character = await ctx.characters.get(id);
        showLumiverseChatPicker(id, String(character?.name || "character"), chats);
      } else if (Array.isArray(chats) && chats.length === 1) {
        navigateLumiverseChatInPlace(chats[0]?.id);
      } else {
        await startNewLumiverseChat(id);
      }
      completed = true;
      setStatus("");
    } catch (error) {
      const message = publicErrorMessage(error, "Could not open this Lumiverse chat.");
      setStatus(message, true);
      sendNativeToast("error", message, "Lumiverse chat");
    } finally {
      const remainingDwell =
        CHAT_LOADING_MIN_MS - (performance.now() - loadingStartedAt);
      if (remainingDwell > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingDwell));
      }
      state.chatOpeningId = "";
      setChatButtonLoading(button, false);
      if (completed && closeDetailWhenReady) closeCharacterModal();
    }
  }

  function renderCard(character) {
    const id = normalizeId(character.id);
    const lumiverseCharacterId = savedLumiverseId(id);
    const isSaved = Boolean(lumiverseCharacterId);
    const creator = characterCreator(character);
    const creatorRef = characterCreatorRef(character);
    const stats = characterStats(character);
    const avatarUrl = displayAvatarUrl(character);
    const isImporting = state.importId === id;
    const isOpeningChat = state.chatOpeningId === lumiverseCharacterId;
    const score = scorePresentation(character.score);
    const hasScore = Number.isFinite(Number(character.score));
    const publishedValue = character.publishedAt || character.updatedAt;
    const publishedBadge = compactDateBadge(publishedValue);
    return `
      <article class="dcv1-card" tabindex="0" data-card="${escapeAttribute(id)}" data-added="${isSaved}">
        <div class="dcv1-cover-wrap">
          ${avatarUrl
            ? `<img class="dcv1-cover" src="${escapeAttribute(avatarUrl)}" alt="" loading="lazy">`
            : `<div class="dcv1-cover-missing">${CAT_ICON}<span>Image pending</span></div>`}
          ${isSaved ? '<span class="dcv1-added-badge">Added</span>' : ""}
          ${publishedBadge
            ? `<time class="dcv1-card-date" datetime="${escapeAttribute(publishedValue)}" title="${escapeAttribute(readableDate(publishedValue))}">${escapeHtml(publishedBadge)}</time>`
            : ""}
          ${stats.tokens
            ? `<span class="dcv1-card-token" title="Total tokens">${escapeHtml(stats.tokens)} tokens</span>`
            : ""}
          ${hasScore
            ? `<span class="dcv1-card-score" data-tier="${escapeAttribute(score.tier)}" title="Datacat rating score">${escapeHtml(score.label)}</span>`
            : ""}
        </div>
        <div class="dcv1-card-body">
          <div class="dcv1-name" title="${escapeAttribute(character.name)}">${escapeHtml(character.name || "Untitled")}</div>
          <div class="dcv1-card-author">
            <span class="dcv1-author-label">Author</span>
            ${creatorRef
              ? `<button class="dcv1-creator-link" type="button" data-creator-ref="${escapeAttribute(creatorRef)}">${escapeHtml(creator)}</button>`
              : escapeHtml(creator)}
          </div>
          <div class="dcv1-card-actions">
            ${isSaved
              ? `
                  <button class="dcv1-button" data-added type="button" disabled>✓ Added</button>
                  <button class="dcv1-button" type="button" data-chat-import="${escapeAttribute(lumiverseCharacterId)}" ${isOpeningChat ? 'data-loading="true" aria-busy="true" aria-label="Opening chat"' : ""} ${state.chatOpeningId ? "disabled" : ""}>${isOpeningChat ? "" : "Chat"}</button>
                `
              : `
                  <button class="dcv1-button" data-primary ${isImporting ? 'data-loading="true"' : ""} type="button" data-import="${escapeAttribute(id)}" ${state.importId ? "disabled" : ""}>
                    ${isImporting ? "Importing…" : "Import"}
                  </button>
                `}
          </div>
        </div>
      </article>`;
  }

  function closeCharacterModal() {
    state.selectedSerial += 1;
    state.communitySerial += 1;
    state.selected = null;
    state.selectedLoading = false;
    state.selectedError = "";
    state.community = null;
    state.communityCharacterId = "";
    state.communityLoading = false;
    state.communityError = "";
    state.communitySubmitting = "";
    state.communityKudosOpen = false;
    state.communityComposerOpen = false;
    state.communityDraft = "";
    renderProfile();
  }

  function renderCharacterCommunity(characterId) {
    if (
      state.communityCharacterId !== characterId ||
      (state.communityLoading && !state.community)
    ) {
      return `
        <section class="dcv1-community" aria-label="Datacat community">
          <div class="dcv1-community-head">
            <strong>Community</strong>
          </div>
          <div class="dcv1-status">Loading kudos and comments…</div>
        </section>`;
    }
    if (state.communityError && !state.community) {
      return `
        <section class="dcv1-community" aria-label="Datacat community">
          <div class="dcv1-community-head">
            <strong>Community</strong>
          </div>
          <div class="dcv1-status" data-error>${escapeHtml(state.communityError)}</div>
          <button class="dcv1-button" type="button" data-community-retry>Retry</button>
        </section>`;
    }
    const community = state.community || {};
    const kudosTotal = Math.max(
      0,
      Number(community.kudos?.total || 0) || 0,
    );
    const commentTotal = Math.max(
      0,
      Number(community.comments?.total || 0) || 0,
    );
    const comments = Array.isArray(community.comments?.items)
      ? community.comments.items
      : [];
    const kudosGifts = Array.isArray(community.kudos?.gifts)
      ? community.kudos.gifts.filter(
          (gift) =>
            gift &&
            String(gift.emoji || "").trim() &&
            Number(gift.count) > 0,
        )
      : [];
    const kudosOptions = Array.isArray(community.kudos?.options)
      ? community.kudos.options.filter(
          (gift) =>
            gift &&
            String(gift.key || "").trim() &&
            String(gift.emoji || "").trim(),
        )
      : [];
    const loggedIn =
      state.accountState === "logged_in" &&
      Boolean(state.linkedAccount);
    const submittingKudos = state.communitySubmitting.startsWith("kudos:");
    const submittingGiftKey = submittingKudos
      ? state.communitySubmitting.slice("kudos:".length)
      : "";
    const submittingComment = state.communitySubmitting === "comment";
    return `
      <section class="dcv1-community" aria-label="Datacat community">
        <div class="dcv1-community-head">
          <strong>Community</strong>
          <span class="dcv1-community-counts">${compactNumber(kudosTotal)} kudos · ${compactNumber(commentTotal)} comments</span>
        </div>
        ${kudosGifts.length
          ? `<div class="dcv1-kudos-summary" aria-label="Kudos received">${kudosGifts
              .map(
                (gift) =>
                  `<span class="dcv1-kudos-count" title="${escapeAttribute(gift.label || gift.key || "Kudos")}"><span>${escapeHtml(gift.emoji)}</span>${compactNumber(gift.count)}</span>`,
              )
              .join("")}</div>`
          : ""}
        <div class="dcv1-community-actions">
          <button class="dcv1-button" data-kudos type="button" data-community-kudos ${state.communitySubmitting ? "disabled" : ""}>
            ${submittingKudos ? "Sending…" : state.communityKudosOpen ? "♥ Hide kudos" : "♥ Choose kudos"}
          </button>
          <button class="dcv1-button" type="button" data-community-comment-open ${state.communitySubmitting ? "disabled" : ""}>
            Comment
          </button>
        </div>
        ${state.communityKudosOpen
          ? `
            <div class="dcv1-kudos-picker">
              <div class="dcv1-kudos-picker-head">
                <strong>Choose kudos</strong>
                <button class="dcv1-kudos-picker-close" type="button" data-community-kudos-close ${submittingKudos ? "disabled" : ""}>Close</button>
              </div>
              ${kudosOptions.length
                ? `<div class="dcv1-kudos-grid">${kudosOptions
                    .map(
                      (gift) => `
                        <button class="dcv1-kudos-option" type="button" data-community-gift="${escapeAttribute(gift.key)}" ${state.communitySubmitting ? "disabled" : ""} title="${escapeAttribute(gift.description || gift.label || "Send kudos")}">
                          <span class="dcv1-kudos-emoji">${escapeHtml(gift.emoji)}</span>
                          <span class="dcv1-kudos-copy">
                            <strong>${escapeHtml(gift.label || gift.key)}${submittingGiftKey === gift.key ? "…" : ""}</strong>
                            <span>${escapeHtml(gift.description || "Send to creator")}</span>
                          </span>
                        </button>`,
                    )
                    .join("")}</div>`
                : `<div class="dcv1-status">Kudos choices are unavailable. Refresh and try again.</div>`}
            </div>`
          : ""}
        ${!loggedIn
          ? `<div class="dcv1-status">Log in to Datacat to give kudos or comment.</div>`
          : ""}
        ${state.communityError
          ? `<div class="dcv1-status" data-error>${escapeHtml(state.communityError)}</div>`
          : ""}
        ${state.communityComposerOpen
          ? `
            <div class="dcv1-community-composer">
              <textarea data-community-draft maxlength="4000" rows="3" placeholder="Leave a comment for the creator…">${escapeHtml(state.communityDraft)}</textarea>
              <div class="dcv1-community-composer-actions">
                <button class="dcv1-button" type="button" data-community-comment-cancel ${submittingComment ? "disabled" : ""}>Cancel</button>
                <button class="dcv1-button" data-primary type="button" data-community-comment-submit ${submittingComment || !state.communityDraft.trim() ? "disabled" : ""}>
                  ${submittingComment ? "Posting…" : "Post comment"}
                </button>
              </div>
            </div>`
          : ""}
        <div class="dcv1-community-comments">
          ${comments.length
            ? comments
                .map(
                  (comment) => `
                    <article class="dcv1-community-comment">
                      <div class="dcv1-community-comment-head">
                        <strong>@${escapeHtml(comment.author?.username || "Datacat user")}${comment.mine ? " · You" : ""}</strong>
                        <time datetime="${escapeAttribute(comment.createdAt || "")}">${escapeHtml(relativeTime(comment.createdAt))}</time>
                      </div>
                      <p>${escapeHtml(comment.body || "")}</p>
                    </article>`,
                )
                .join("")
            : `<div class="dcv1-status">No comments yet.</div>`}
        </div>
      </section>`;
  }

  function renderCharacterModal() {
    const character = state.selected;
    const shouldOpen = Boolean(
      character || state.selectedLoading || state.selectedError,
    );
    const wasOpen = modalHost.dataset.open === "true";
    const previousBodyScrollTop =
      modalHost.querySelector(".dcv1-character-modal-body")?.scrollTop || 0;
    const previousInfoScrollTop =
      modalHost.querySelector(".dcv1-character-info")?.scrollTop || 0;
    modalHost.dataset.open = String(shouldOpen);
    modalHost.setAttribute("aria-hidden", String(!shouldOpen));
    document.body.classList.toggle("dcv1-character-modal-open", shouldOpen);
    if (!shouldOpen) {
      modalHost.replaceChildren();
      if (wasOpen && modalReturnFocus?.isConnected) {
        modalReturnFocus.focus({ preventScroll: true });
      }
      modalReturnFocus = null;
      return;
    }
    if (state.selectedError && !character) {
      modalHost.innerHTML = `
        <div class="dcv1-modal-layer" data-character-backdrop>
          <article class="dcv1-character-modal" role="dialog" aria-modal="true" aria-label="Character unavailable">
            <header class="dcv1-character-modal-head">
              <span>DATACAT BROWSER - Character Details</span>
              <button class="dcv1-button" type="button" data-back aria-label="Close character">Close</button>
            </header>
            <div class="dcv1-empty" data-error>
              ${escapeHtml(state.selectedError)}
              <button class="dcv1-button" data-primary type="button" data-retry-profile="${escapeAttribute(state.communityCharacterId)}">Try again</button>
            </div>
          </article>
        </div>`;
      return;
    }
    if (!wasOpen) {
      modalReturnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    if (state.selectedLoading && !character) {
      modalHost.innerHTML = `
        <div class="dcv1-modal-layer" data-character-backdrop>
          <article class="dcv1-character-modal" role="dialog" aria-modal="true" aria-label="Loading character">
            <header class="dcv1-character-modal-head">
              <span>DATACAT BROWSER - Character Details</span>
              <button class="dcv1-button" type="button" data-back aria-label="Close character">Close</button>
            </header>
            <div class="dcv1-empty">Loading character…</div>
          </article>
        </div>`;
      if (!wasOpen) {
        requestAnimationFrame(() =>
          modalHost.querySelector("[data-back]")?.focus(),
        );
      }
      return;
    }
    const creator = characterCreator(character);
    const creatorRef = characterCreatorRef(character);
    const tags = characterTags(character);
    const avatarUrl = displayAvatarUrl(character);
    const characterId = normalizeId(character.id);
    const isImporting = state.importId === characterId;
    const lumiverseCharacterId = savedLumiverseId(characterId);
    const isOpeningChat = state.chatOpeningId === lumiverseCharacterId;
    const stats = characterStats(character);
    const score = scorePresentation(character.score);
    const published = readableDate(character.publishedAt || character.updatedAt);
    const statItems = [
      ["Chats", stats.chats],
      ["Messages", stats.messages],
      ["Tokens", stats.tokens],
      ["Published", published],
    ].filter(([, value]) => String(value || "").trim());
    const botUrl = botPageUrl(character, apiOrigin());
    const profileDescription = renderRichText(
      retargetRetrievedBy(character.description, botUrl),
      { origin: apiOrigin() },
    );
    const loadedCard = state.cardCache.get(characterId) || null;
    const tabs = loadedCard
      ? cardTabs(loadedCard, {
          origin: apiOrigin(),
          fallbackDescription: character.description,
          botUrl,
        })
      : [];
    const chosenTab = state.cardTabChoice.get(characterId);
    const activeTab = tabs.find((tab) => tab.id === chosenTab) || tabs[0] || null;
    const description = activeTab || profileDescription;
    const cardLoading = state.cardLoading.has(characterId);
    const cardError = state.cardErrors.get(characterId) || "";
    const cardBookEntries = lorebookEntryCount(findCharacterBook(loadedCard));
    const lorebookInfo = cardBookEntries
      ? { has: true, count: cardBookEntries }
      : profileLorebookInfo(character);
    // Images written into the text render inline; the strip is only for
    // images the API lists separately, so nothing appears twice.
    const inlineUrls = new Set(
      [profileDescription, ...tabs].flatMap((item) => item.images.map((image) => image.url)),
    );
    const gallery = collectGalleryImages(character, apiOrigin()).filter(
      (image) => image.url !== avatarUrl && !inlineUrls.has(image.url),
    );
    modalHost.innerHTML = `
      <div class="dcv1-modal-layer" data-character-backdrop>
        <article class="dcv1-character-modal" role="dialog" aria-modal="true" aria-labelledby="dcv1-character-title">
          <header class="dcv1-character-modal-head">
            <span>DATACAT BROWSER - Character Details</span>
            <button class="dcv1-button" type="button" data-back aria-label="Close character">Close</button>
          </header>
          <div class="dcv1-character-modal-body">
            <div class="dcv1-character-hero">
              ${avatarUrl
                ? `<img class="dcv1-cover" src="${escapeAttribute(avatarUrl)}" alt="">`
                : `<div class="dcv1-cover-missing">${CAT_ICON}<span>Image pending</span></div>`}
              <div class="dcv1-score-badge" data-tier="${escapeAttribute(score.tier)}" title="Datacat score">
                <strong>${escapeHtml(score.label)}</strong>
                <span>${escapeHtml(score.detail)}</span>
              </div>
            </div>
            <div class="dcv1-character-info">
              <h1 class="dcv1-character-name" id="dcv1-character-title">${escapeHtml(character.name || "Untitled")}</h1>
              <div class="dcv1-character-byline">
                by ${creatorRef
                  ? `<button class="dcv1-creator-link" type="button" data-creator-ref="${escapeAttribute(creatorRef)}">${escapeHtml(creator)}</button>`
                  : escapeHtml(creator)}
              </div>
              ${statItems.length
                ? `<div class="dcv1-character-stat-strip">${statItems
                    .map(
                      ([label, value]) => `<div class="dcv1-stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`,
                    )
                    .join("")}</div>`
                : ""}
              ${lorebookInfo.has
                ? `<div class="dcv1-lore-chip" title="This character ships with a lorebook that is imported into Lumiverse automatically.">
                    <span aria-hidden="true">📖</span>
                    <strong>Lorebook</strong>${lorebookInfo.count ? `<span>${lorebookInfo.count} ${lorebookInfo.count === 1 ? "entry" : "entries"}</span>` : ""}
                  </div>`
                : ""}
              <section class="dcv1-detail-section">
                <h2 class="dcv1-detail-heading">About</h2>
                ${tabs.length > 1
                  ? `<div class="dcv1-card-tabs" role="tablist">${tabs
                      .map(
                        (tab) => `<button class="dcv1-card-tab" type="button" role="tab" aria-selected="${tab === activeTab}" data-card-id="${escapeAttribute(characterId)}" data-card-tab="${escapeAttribute(tab.id)}">${escapeHtml(tab.label)}${tab.count ? ` <span>${tab.count}</span>` : ""}</button>`,
                      )
                      .join("")}</div>`
                  : ""}
                ${description.html
                  ? `<div class="dcv1-rich">${description.html}</div>`
                  : `<p class="dcv1-rich-empty">No description available.</p>`}
                ${loadedCard
                  ? ""
                  : `<div class="dcv1-card-load">
                      <button class="dcv1-button" type="button" data-load-card="${escapeAttribute(characterId)}" ${cardLoading ? 'data-loading="true"' : ""} ${cardLoading || state.importId ? "disabled" : ""}>${cardLoading ? "Loading full card…" : cardError ? "Try again" : getVerificationLease() ? "Load full card" : "Verify & load full card"}</button>
                      <span>${cardError ? escapeHtml(cardError) : cardLoading ? "Fetching the full card…" : getVerificationLease() ? "Greeting, scenario, example dialogue and images." : "One-time security check per session. After that, characters open in full view automatically."}</span>
                    </div>`}
              </section>
              ${tags.length
                ? `<section class="dcv1-detail-section">
                    <h2 class="dcv1-detail-heading">Tags</h2>
                    <div class="dcv1-profile-tags">${tags
                      .map((tag) => `<button class="dcv1-tag" type="button" data-tag-name="${escapeAttribute(tag)}">${escapeHtml(tag)}</button>`)
                      .join("")}</div>
                  </section>`
                : ""}
              ${gallery.length
                ? `<section class="dcv1-detail-section">
                    <h2 class="dcv1-detail-heading">Images <span>${gallery.length}</span></h2>
                    <div class="dcv1-gallery">${gallery
                      .map(
                        (image) => `<button class="dcv1-gallery-item" type="button" data-lightbox-src="${escapeAttribute(image.url)}" aria-label="${escapeAttribute(image.alt || "Open image")}">
                          <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                        </button>`,
                      )
                      .join("")}</div>
                  </section>`
                : ""}
              ${renderCharacterCommunity(characterId)}
              ${state.selectedLoading
                ? `<div class="dcv1-status">Loading complete character details…</div>`
                : ""}
            </div>
          </div>
          <footer class="dcv1-character-modal-actions">
            ${lumiverseCharacterId
              ? `
                  <span class="dcv1-character-added-text">Added to Lumiverse</span>
                  <button class="dcv1-button" data-primary type="button" data-view-import="${escapeAttribute(lumiverseCharacterId)}">View</button>
                  <button class="dcv1-button" type="button" data-chat-import="${escapeAttribute(lumiverseCharacterId)}" ${isOpeningChat ? 'data-loading="true" aria-busy="true" aria-label="Opening chat"' : ""} ${state.chatOpeningId ? "disabled" : ""}>${isOpeningChat ? "" : "Chat"}</button>
                `
              : `
                  <button class="dcv1-button" data-primary ${isImporting ? 'data-loading="true"' : ""} type="button" data-import="${escapeAttribute(character.id)}" ${state.importId || state.cardLoading.size ? "disabled" : ""}>
                    ${isImporting ? "Importing…" : "Import"}
                  </button>
                `}
          </footer>
        </article>
      </div>`;
    if (!wasOpen) {
      requestAnimationFrame(() =>
        modalHost.querySelector("[data-back]")?.focus(),
      );
    } else {
      const body = modalHost.querySelector(".dcv1-character-modal-body");
      const info = modalHost.querySelector(".dcv1-character-info");
      if (body) body.scrollTop = previousBodyScrollTop;
      if (info) info.scrollTop = previousInfoScrollTop;
    }
  }

  function renderProfile() {
    renderCharacterModal();
    const creatorScrollTop =
      profileHost.querySelector("[data-creator-scroll]")?.scrollTop || 0;
    const creatorProfile = state.selectedCreator;
    if (!creatorProfile && !state.creatorLoading) {
      creatorObserver.disconnect();
      profileHost.replaceChildren();
      return;
    }
    if (creatorProfile || state.creatorLoading) {
      if (state.creatorLoading && !creatorProfile) {
        creatorObserver.disconnect();
        profileHost.innerHTML = `
          <section class="dcv1-profile">
            <nav class="dcv1-profile-nav">
              <button class="dcv1-button" type="button" data-creator-back>Back</button>
              <div class="dcv1-profile-nav-title">DATACAT BROWSER - Creator Profile</div>
            </nav>
            <div class="dcv1-empty">Loading creator profile…</div>
          </section>`;
        return;
      }
      const creatorAvatar = advertisedImageUrl({
        avatarUrl: creatorProfile.avatarUrl,
      });
      const stats = creatorProfile.stats || {};
      const topTags = Array.isArray(creatorProfile.topTags)
        ? creatorProfile.topTags
        : [];
      const handle = String(creatorProfile.handle || "").replace(/^@+/, "");
      const creatorStats = [
        ["Characters", stats.characters],
        ["Chats", stats.chats],
        ["Messages", stats.messages],
        ["Followers", stats.followers],
      ];
      profileHost.innerHTML = `
        <section class="dcv1-profile">
          <nav class="dcv1-profile-nav">
            <button class="dcv1-button" type="button" data-creator-back>Back</button>
            <div class="dcv1-profile-nav-title">DATACAT BROWSER - Creator Profile</div>
          </nav>
          <div class="dcv1-profile-scroll" data-creator-scroll>
            <main class="dcv1-creator-page">
              <section class="dcv1-creator-hero">
                <div class="dcv1-creator-identity">
                  <div class="dcv1-creator-kicker">Creator profile</div>
                  <h1 class="dcv1-profile-title">${escapeHtml(creatorProfile.name || "Unknown creator")}${creatorProfile.verified ? '<span class="dcv1-verified" title="Verified creator">✓</span>' : ""}</h1>
                  ${handle ? `<div class="dcv1-creator-handle">@${escapeHtml(handle)}</div>` : ""}
                </div>
                <div class="dcv1-creator-media">
                  ${creatorAvatar
                    ? `<img class="dcv1-profile-avatar" src="${escapeAttribute(creatorAvatar)}" alt="">`
                    : `<div class="dcv1-profile-avatar dcv1-cover-missing">${CAT_ICON}</div>`}
                </div>
                <div class="dcv1-creator-tag-panel">
                  <div class="dcv1-creator-tag-heading">Tags</div>
                  ${topTags.length
                    ? `<div class="dcv1-profile-tags">${topTags
                        .map(
                          (tag) => `<button class="dcv1-tag" type="button" data-creator-tag-slug="${escapeAttribute(tag.slug)}" data-selected="${state.creatorTagSlugs.has(tag.slug)}"><span>${escapeHtml(tag.name)}</span>${tag.count ? `<span class="dcv1-tag-count">${compactNumber(tag.count)}</span>` : ""}</button>`,
                        )
                        .join("")}</div>`
                    : `<div class="dcv1-creator-tags-empty">No tags available.</div>`}
                </div>
                <div class="dcv1-creator-stat-strip">${creatorStats
                  .map(
                    ([label, value]) => `<div class="dcv1-stat"><strong>${escapeHtml(compactNumber(value) || "0")}</strong><span>${escapeHtml(label)}</span></div>`,
                  )
                  .join("")}</div>
              </section>
              <section class="dcv1-creator-about">
                <div class="dcv1-section-head"><h2>About</h2></div>
                <div class="dcv1-creator-about-copy">${escapeHtml(creatorProfile.about || "No creator biography is available.")}</div>
              </section>
              <section class="dcv1-creator-catalog">
                <div class="dcv1-section-head">
                  <h2>Characters</h2>
                  <span>${state.creatorTagSlugs.size
                    ? `${state.creatorTagSlugs.size} tag filter${state.creatorTagSlugs.size === 1 ? "" : "s"}`
                    : `${state.creatorCharacters.length} loaded`}</span>
                </div>
                ${state.creatorError
                  ? `<div class="dcv1-empty" data-error>${escapeHtml(state.creatorError)}</div>`
                  : ""}
                ${state.creatorCharacters.length
                  ? `<div class="dcv1-creator-grid">${state.creatorCharacters.map(renderCard).join("")}</div>`
                  : state.creatorLoading
                    ? `<div class="dcv1-empty">Loading characters…</div>`
                    : `<div class="dcv1-empty">No importable characters found.</div>`}
                <button class="dcv1-infinite-sentinel" type="button" data-creator-sentinel data-loading="${state.creatorLoadingMore}" ${state.creatorHasMore ? "" : "hidden"} ${state.creatorError && !state.creatorLoadingMore ? "" : "disabled"}>
                  ${state.creatorLoadingMore
                    ? "Loading more characters…"
                    : state.creatorError
                      ? "Could not load more. Tap to retry."
                      : "Scroll for more"}
                </button>
              </section>
            </main>
          </div>
        </section>`;
      const creatorScroll = profileHost.querySelector(
        "[data-creator-scroll]",
      );
      if (creatorScroll) creatorScroll.scrollTop = creatorScrollTop;
      observeCreatorSentinel();
      return;
    }
  }

  function freshHasMore() {
    return (
      state.freshPaging.last24h.hasMore === true ||
      state.freshPaging.thisWeek.hasMore === true
    );
  }

  function freshCharacterCount() {
    return (
      state.freshWindows.last24h.length +
      state.freshWindows.thisWeek.length
    );
  }

  function renderFreshRow(character) {
    const id = normalizeId(character.id);
    const lumiverseCharacterId = savedLumiverseId(id);
    const isSaved = Boolean(lumiverseCharacterId);
    const isImporting = state.importId === id;
    const creator = characterCreator(character);
    const creatorRef = characterCreatorRef(character);
    const avatarUrl = displayAvatarUrl(character);
    const score = scorePresentation(character.score);
    const hasScore = Number.isFinite(Number(character.score));
    const stats = characterStats(character);
    const age = relativeTime(
      character.freshAt ||
        character.updatedAt ||
        character.firstDiscoveredAt,
    );
    const spottedBy = String(character.spottedBy?.username || "")
      .trim()
      .replace(/^@+/, "");
    const tags = characterTags(character).slice(0, 4);
    const messagesPerChat = Number.isFinite(stats.messagesPerChat)
      ? stats.messagesPerChat.toFixed(1)
      : "";
    const publishedValue = character.publishedAt || character.updatedAt;
    const publishedBadge = compactDateBadge(publishedValue);
    return `
      <article class="dcv1-fresh-row" tabindex="0" data-card="${escapeAttribute(id)}" data-added="${isSaved}">
        <div class="dcv1-fresh-title" title="${escapeAttribute(character.name)}">${escapeHtml(character.name || "Untitled")}</div>
        <div class="dcv1-fresh-cover">
          ${avatarUrl
            ? `<img class="dcv1-cover" src="${escapeAttribute(avatarUrl)}" alt="" loading="lazy">`
            : `<div class="dcv1-cover-missing">${CAT_ICON}<span>Image pending</span></div>`}
          ${publishedBadge
            ? `<time class="dcv1-fresh-date" datetime="${escapeAttribute(publishedValue)}" title="${escapeAttribute(readableDate(publishedValue))}">${escapeHtml(publishedBadge)}</time>`
            : ""}
          ${stats.tokens
            ? `<span class="dcv1-fresh-token" title="Total tokens">${escapeHtml(stats.tokens)} tokens</span>`
            : ""}
        </div>
        <div class="dcv1-fresh-copy">
          <div class="dcv1-fresh-meta">
            <span class="dcv1-author-label">Author</span>
            ${creatorRef
              ? `<button class="dcv1-creator-link" type="button" data-creator-ref="${escapeAttribute(creatorRef)}">${escapeHtml(creator)}</button>`
              : escapeHtml(creator)}
            ${spottedBy ? ` · Spotted by @${escapeHtml(spottedBy)}` : ""}
          </div>
          <p class="dcv1-fresh-description">${escapeHtml(snippetText(character.description, 320))}</p>
          ${tags.length
            ? `<div class="dcv1-fresh-tags">${tags
                .map(
                  (tag) =>
                    `<span class="dcv1-fresh-tag">${escapeHtml(tag)}</span>`,
                )
                .join("")}</div>`
            : ""}
        </div>
        <div class="dcv1-fresh-rail">
          <time class="dcv1-fresh-age" datetime="${escapeAttribute(character.freshAt || character.updatedAt || "")}">${escapeHtml(age)}</time>
          ${hasScore
            ? `<span class="dcv1-fresh-score" data-tier="${escapeAttribute(score.tier)}" title="Datacat rating score">${escapeHtml(score.label)}</span>`
            : ""}
          ${messagesPerChat
            ? `<span class="dcv1-fresh-metric"><span>Msg/chat</span><strong>${escapeHtml(messagesPerChat)}</strong></span>`
            : ""}
          ${isSaved
            ? `<button class="dcv1-button" data-added type="button" data-view-import="${escapeAttribute(lumiverseCharacterId)}">✓ Added</button>`
            : `<button class="dcv1-button" data-primary ${isImporting ? 'data-loading="true"' : ""} type="button" data-import="${escapeAttribute(id)}" ${state.importId ? "disabled" : ""}>${isImporting ? "Importing…" : "Import"}</button>`}
        </div>
      </article>`;
  }

  function renderFreshWindow(title, detail, characters) {
    if (!characters.length) return "";
    return `
      <section class="dcv1-fresh-section">
        <header class="dcv1-fresh-head">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(detail)}</span>
        </header>
        <div class="dcv1-fresh-list">
          ${characters.map(renderFreshRow).join("")}
        </div>
      </section>`;
  }

  function render() {
    const isFresh = state.viewMode === "fresh";
    const isImports = state.viewMode === "imports";
    syncCatalogSortControl();
    searchClear.hidden = !state.query;
    for (const button of viewModeButtons) {
      const active = button.dataset.viewMode === state.viewMode;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
    }
    searchRow.hidden = state.viewMode !== "catalog";
    if (isFresh) {
      const freshCount = freshCharacterCount();
      if ((state.initializing || state.freshLoading) && freshCount === 0) {
        grid.innerHTML = renderLoadingState("Loading fresh discoveries…");
      } else if (state.freshError && freshCount === 0) {
        grid.innerHTML = `<div class="dcv1-empty" data-error>${escapeHtml(state.freshError)}</div>`;
      } else if (freshCount === 0) {
        grid.innerHTML = `<div class="dcv1-empty">No newly discovered characters are available.</div>`;
      } else {
        grid.innerHTML = [
          renderFreshWindow(
            "New in the last 24 hours",
            `${state.freshWindows.last24h.length} loaded`,
            state.freshWindows.last24h,
          ),
          renderFreshWindow(
            "Discovered this week",
            `${state.freshWindows.thisWeek.length} loaded`,
            state.freshWindows.thisWeek,
          ),
        ].join("");
      }
    } else if (isImports) {
      grid.innerHTML = renderImports();
    } else {
      if ((state.initializing || state.loading) && state.characters.length === 0) {
        grid.innerHTML = renderLoadingState("Loading the catalog…");
      } else if (state.error) {
        grid.innerHTML = `<div class="dcv1-empty" data-error>${escapeHtml(state.error)}</div>`;
      } else if (state.characters.length === 0) {
        grid.innerHTML = `<div class="dcv1-empty">No characters found.</div>`;
      } else {
        grid.innerHTML = state.characters.map(renderCard).join("");
      }
    }
    const hasMore = isImports ? false : isFresh ? freshHasMore() : state.hasMore;
    const loading = isImports
      ? state.savedLoading
      : isFresh
        ? state.freshLoading
        : state.loading;
    const loadingMore = isImports
      ? false
      : isFresh
      ? state.freshLoadingMore
      : state.loadingMore;
    const loadMoreError = isImports
      ? ""
      : isFresh
      ? state.freshLoadMoreError
      : state.loadMoreError;
    const error = isImports
      ? state.savedError
      : isFresh
        ? state.freshError
        : state.error;
    catalogSentinel.hidden = !hasMore || Boolean(error);
    catalogSentinel.disabled =
      loading || loadingMore || !loadMoreError;
    catalogSentinel.dataset.loading = String(loadingMore);
    catalogSentinel.textContent = loadingMore
      ? "Loading more characters…"
      : loadMoreError
        ? `${loadMoreError} Tap to retry.`
        : "Scroll for more";
    const accountName =
      state.linkedAccount?.displayName ||
      state.linkedAccount?.username ||
      "Datacat";
    const loggedIn =
      state.accountState === "logged_in" &&
      Boolean(state.linkedAccount);
    const linkedAnonymous =
      state.accountState === "linked_anonymous";
    const accountBusy =
      state.accountState === "loading" || state.accountLinking;
    const accountBusyLabel = state.accountLinking ? "Connecting…" : "Checking…";
    accountSummaryLabel.textContent = accountBusy
      ? accountBusyLabel
      : loggedIn
        ? `Connected · ${accountName}`
        : linkedAnonymous
          ? "Anonymous"
          : "Not connected";
    accountSummarySpinner.hidden = !accountBusy;
    accountSummary.setAttribute("aria-busy", String(accountBusy));
    const accountMenuLabel = state.accountChoiceOpen
      ? "Connect to Datacat"
      : "Account";
    const accountMenuState = accountBusy
      ? `<span class="dcv1-inline-spinner" aria-hidden="true"></span>${accountBusyLabel}`
      : state.accountChoiceOpen
        ? "How do you want to connect?"
      : escapeHtml(
          loggedIn
            ? accountName
            : linkedAnonymous
              ? "Anonymous"
              : "Not connected",
        );
    const accountActions = accountBusy
      ? ""
      : state.accountChoiceOpen
        ? `<div class="dcv1-account-actions dcv1-account-choice-actions">
            <button class="dcv1-button" type="button" data-connect-anonymous>Anonymous account (rate limits apply)</button>
            <button class="dcv1-button" type="button" data-connect-login>Log in to Datacat</button>
          </div>`
      : loggedIn
        ? `<div class="dcv1-account-actions">
            <button class="dcv1-button" type="button" data-account-choice>Switch</button>
            <button class="dcv1-button" type="button" data-logout-account>Logout</button>
          </div>`
        : linkedAnonymous
          ? `<div class="dcv1-account-actions">
              <button class="dcv1-button" type="button" data-account-choice>Switch</button>
              <button class="dcv1-button" type="button" data-logout-account>Disconnect</button>
            </div>`
          : `<div class="dcv1-account-actions">
              <button class="dcv1-button" type="button" data-account-choice>Connect</button>
            </div>`;
    menuPanel.innerHTML = `
      <div class="dcv1-menu-section">
        <div class="dcv1-menu-copy">
          <div class="dcv1-menu-label">${accountMenuLabel}</div>
          <div class="dcv1-menu-state" aria-busy="${accountBusy}">${accountMenuState}</div>
        </div>
      </div>
      ${accountActions}
    `;
    renderTagBrowser();
    renderProfile();
    renderImportFeedback();
    restorePersistedScroll();
  }

  async function requestBackendLinkIndex({ force = false } = {}) {
    const granted = await ctx.permissions.getGranted();
    if (!granted.includes("characters")) {
      const next = await ctx.permissions.request(
        ["characters"],
        {
          reason: "Show your Lumiverse imports.",
        },
      );
      if (!next.includes("characters")) {
        throw new Error(
          "Allow Characters access to show imports.",
        );
      }
    }
    const requestId = uuidv7();
    return await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingLinkIndexRequests.delete(requestId);
        reject(
          new Error(
            "Lumiverse’s Datacat library check did not respond.",
          ),
        );
      }, 45_000);
      pendingLinkIndexRequests.set(requestId, {
        resolve,
        reject,
        timer,
      });
      try {
        ctx.sendToBackend({
          type: "datacat_link_index_request",
          requestId,
          force,
        });
      } catch (error) {
        window.clearTimeout(timer);
        pendingLinkIndexRequests.delete(requestId);
        reject(error);
      }
    });
  }

  async function requestBackendCharacterLink(lumiverseCharacterId) {
    const characterId = normalizeId(lumiverseCharacterId);
    if (!characterId) return null;
    const granted = await ctx.permissions.getGranted();
    if (!granted.includes("characters")) {
      const next = await ctx.permissions.request(
        ["characters"],
        {
          reason: "Connect this chat to its Datacat character.",
        },
      );
      if (!next.includes("characters")) {
        throw new Error(
          "Allow Characters access to use Datacat community actions.",
        );
      }
    }
    const requestId = uuidv7();
    const payload = await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingLinkIndexRequests.delete(requestId);
        reject(
          new Error(
            "Lumiverse’s Datacat character check did not respond.",
          ),
        );
      }, 20_000);
      pendingLinkIndexRequests.set(requestId, {
        resolve,
        reject,
        timer,
      });
      try {
        ctx.sendToBackend({
          type: "datacat_character_link_request",
          requestId,
          lumiverseCharacterId: characterId,
        });
      } catch (error) {
        window.clearTimeout(timer);
        pendingLinkIndexRequests.delete(requestId);
        reject(error);
      }
    });
    return payload?.link || null;
  }

  async function loadSavedCharacters({ force = false } = {}) {
    if (state.savedLoading) return;
    state.savedLoading = true;
    state.savedError = "";
    render();
    try {
      const payload = await requestBackendLinkIndex({ force });
      const links = Array.isArray(payload.links) ? payload.links : [];
      setImportRecords(links);
      const next = new Map();
      for (const link of links) {
        const datacatCharacterId = normalizeId(link?.datacatCharacterId);
        const lumiverseCharacterId = normalizeId(link?.lumiverseCharacterId);
        if (datacatCharacterId && lumiverseCharacterId && !next.has(datacatCharacterId)) {
          next.set(datacatCharacterId, lumiverseCharacterId);
        }
      }
      state.savedCharacters = next;
      state.savedLoaded = true;
    } catch (error) {
      state.savedError = publicErrorMessage(error, "Could not check added characters.");
    } finally {
      state.savedLoading = false;
      state.savedLoadedAt = Date.now();
      if (state.characters.length && !state.loading && !state.loadingMore && !state.importId) {
        updateCatalogStatus();
      }
      render();
    }
  }

  async function refreshCatalog({ forceLibrary = false } = {}) {
    const loads = [
      loadAccountState({ force: true }),
      loadSavedCharacters({ force: forceLibrary }),
    ];
    if (state.viewMode === "catalog") {
      loads.push(loadTags({ reset: true }));
      loads.push(loadCharacters({ reset: true }));
    } else if (state.viewMode === "fresh") {
      loads.push(loadFreshCharacters({ reset: true }));
    }
    await Promise.all(loads);
  }

  async function loadTags({ reset = false } = {}) {
    if (state.tagLoading || state.tagLoadingMore) return;
    const serial = ++state.tagSerial;
    state.tagError = "";
    if (reset) {
      state.tagLoading = true;
      state.tagHasMore = false;
      state.tagTotal = 0;
      tagGroups.scrollTop = 0;
    } else {
      state.tagLoadingMore = true;
    }
    renderTagBrowser();
    try {
      const offset = reset ? 0 : state.tagOffset;
      const params = new URLSearchParams({
        limit: "120",
        offset: String(offset),
        sort: state.tagSort,
      });
      if (state.tagQuery) params.set("search", state.tagQuery);
      if (state.selectedTagIds.size) {
        params.set("activeTagIds", [...state.selectedTagIds].join(","));
      }
      const payload = await datacatFetch(`/tags?${params}`);
      if (serial !== state.tagSerial) return;
      const rows = Array.isArray(payload.tags) ? payload.tags : [];
      const merged = reset ? rows : [...state.tags, ...rows];
      state.tags = [...new Map(
        merged.map((tag) => [Number(tag.id), tag]),
      ).values()];
      state.tagGroups = Array.isArray(payload.groups)
        ? payload.groups
        : state.tagGroups;
      state.tagOffset = Number(
        payload.paging?.nextOffset ?? offset + rows.length,
      );
      state.tagTotal = Math.max(
        state.tags.length,
        Number(payload.paging?.totalCount || 0),
      );
      state.tagHasMore = payload.paging?.hasMore === true;
    } catch (error) {
      state.tagError = error.retryAfter
        ? `${publicErrorMessage(error, "Could not load Datacat tags.")} Retry in ${error.retryAfter}s.`
        : publicErrorMessage(error, "Could not load Datacat tags.");
    } finally {
      state.tagLoading = false;
      state.tagLoadingMore = false;
      renderTagBrowser();
    }
  }

  async function updateSelectedTags(nextIds) {
    state.selectedTagIds = new Set(
      [...nextIds].map(Number).filter((id) => Number.isFinite(id) && id > 0),
    );
    state.selectedSerial += 1;
    state.selected = null;
    state.selectedLoading = false;
    state.selectedError = "";
    state.selectedCreator = null;
    state.selectedCreatorRef = "";
    state.creatorCharacters = [];
    renderProfile();
    await Promise.all([
      loadTags({ reset: true }),
      loadCharacters({ reset: true, preserveExisting: true }),
    ]);
  }

  async function selectTagByText(value) {
    const requested = String(value || "").trim().toLowerCase();
    if (!requested) return;
    let tag = state.tags.find(
      (item) =>
        String(item.slug || "").toLowerCase() === requested ||
        String(item.name || "").toLowerCase() === requested,
    );
    if (!tag) {
      try {
        const params = new URLSearchParams({
          search: requested,
          limit: "120",
          offset: "0",
          sort: "count",
        });
        const payload = await datacatFetch(`/tags?${params}`);
        const rows = Array.isArray(payload.tags) ? payload.tags : [];
        state.tags = [...new Map(
          [...state.tags, ...rows].map((item) => [Number(item.id), item]),
        ).values()];
        if (Array.isArray(payload.groups)) state.tagGroups = payload.groups;
        tag = rows.find(
          (item) =>
            String(item.slug || "").toLowerCase() === requested ||
            String(item.name || "").toLowerCase() === requested,
        );
      } catch (error) {
        setStatus(publicErrorMessage(error, "Could not find that Datacat tag."), true);
        return;
      }
    }
    if (!tag) {
      setStatus(`No Datacat tag matched “${value}”.`, true);
      return;
    }
    state.viewMode = "catalog";
    state.tagPanelOpen = true;
    const next = new Set(state.selectedTagIds);
    next.add(Number(tag.id));
    await updateSelectedTags(next);
  }

  async function loadCharacters({
    reset = false,
    preserveExisting = false,
  } = {}) {
    if (state.loading || state.loadingMore) return;
    const serial = ++state.serial;
    state.error = "";
    state.loadMoreError = "";
    if (reset) {
      state.loading = true;
      state.hasMore = false;
      catalogScroll.scrollTop = 0;
    } else {
      state.loadingMore = true;
    }
    if (!preserveExisting) render();
    try {
      const offset = reset ? 0 : state.offset;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: state.catalogSort,
      });
      if (state.query) params.set("search", state.query);
      if (state.selectedTagIds.size) {
        params.set("tagIds", [...state.selectedTagIds].join(","));
      }
      const payload = await datacatFetch(`/characters?${params}`);
      if (serial !== state.serial) return;
      const rows = Array.isArray(payload.characters) ? payload.characters : [];
      state.characters = reset ? rows : [...state.characters, ...rows];
      state.offset = Number(payload.paging?.nextOffset ?? offset + rows.length);
      state.hasMore = payload.paging?.hasMore === true;
      updateCatalogStatus();
    } catch (error) {
      const message = error.retryAfter
        ? `${publicErrorMessage(error, "Could not load Datacat.")} Retry in ${error.retryAfter}s.`
        : publicErrorMessage(error, "Could not load Datacat.");
      if (reset || state.characters.length === 0) {
        state.error = message;
      } else {
        state.loadMoreError = message;
      }
      setStatus(message, true);
    } finally {
      state.loading = false;
      state.loadingMore = false;
      render();
    }
  }

  function appendUniqueCharacters(existing, incoming) {
    const byId = new Map(
      existing.map((character) => [normalizeId(character?.id), character]),
    );
    for (const character of incoming) {
      const id = normalizeId(character?.id);
      if (id && !byId.has(id)) byId.set(id, character);
    }
    return [...byId.values()];
  }

  function normalizeFreshPaging(windowPayload, fallbackOffset, rowCount) {
    const paging = windowPayload?.paging || {};
    const nextOffset = Number(
      paging.nextOffset ?? fallbackOffset + rowCount,
    );
    return {
      hasMore: paging.hasMore === true,
      nextOffset:
        Number.isFinite(nextOffset) && nextOffset >= 0
          ? nextOffset
          : fallbackOffset + rowCount,
    };
  }

  async function loadFreshCharacters({ reset = false } = {}) {
    if (state.freshLoading || state.freshLoadingMore) return;
    const serial = ++state.freshSerial;
    state.freshError = "";
    state.freshLoadMoreError = "";
    if (reset) {
      state.freshLoading = true;
      state.freshWindows = { last24h: [], thisWeek: [] };
      state.freshPaging = {
        last24h: { nextOffset: 0, hasMore: false },
        thisWeek: { nextOffset: 0, hasMore: false },
      };
      catalogScroll.scrollTop = 0;
    } else {
      state.freshLoadingMore = true;
    }
    render();
    try {
      const offset24 = reset
        ? 0
        : Number(
            state.freshPaging.last24h.nextOffset ??
              state.freshWindows.last24h.length,
          );
      const offsetWeek = reset
        ? 0
        : Number(
            state.freshPaging.thisWeek.nextOffset ??
              state.freshWindows.thisWeek.length,
          );
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset24: String(offset24),
        offsetWeek: String(offsetWeek),
        sort: "fresh",
      });
      const payload = await datacatFetch(`/fresh?${params}`);
      if (serial !== state.freshSerial) return;
      const window24 = payload.windows?.last24h || {};
      const windowWeek = payload.windows?.thisWeek || {};
      const rows24 = Array.isArray(window24.characters)
        ? window24.characters
        : [];
      const rowsWeek = Array.isArray(windowWeek.characters)
        ? windowWeek.characters
        : [];
      state.freshWindows = {
        last24h: reset
          ? rows24
          : appendUniqueCharacters(
              state.freshWindows.last24h,
              rows24,
            ),
        thisWeek: reset
          ? rowsWeek
          : appendUniqueCharacters(
              state.freshWindows.thisWeek,
              rowsWeek,
            ),
      };
      state.freshPaging = {
        last24h: normalizeFreshPaging(
          window24,
          offset24,
          rows24.length,
        ),
        thisWeek: normalizeFreshPaging(
          windowWeek,
          offsetWeek,
          rowsWeek.length,
        ),
      };
      updateFreshStatus();
    } catch (error) {
      const message = error.retryAfter
        ? `${publicErrorMessage(error, "Could not load the Datacat Fresh feed.")} Retry in ${error.retryAfter}s.`
        : publicErrorMessage(error, "Could not load the Datacat Fresh feed.");
      if (reset || freshCharacterCount() === 0) {
        state.freshError = message;
      } else {
        state.freshLoadMoreError = message;
      }
      setStatus(message, true);
    } finally {
      state.freshLoading = false;
      state.freshLoadingMore = false;
      render();
    }
  }

  async function loadCharacterCommunity(characterId, { quiet = false } = {}) {
    const id = normalizeId(characterId);
    if (!id) return;
    const communitySerial = ++state.communitySerial;
    if (state.communityCharacterId !== id) {
      state.community = null;
      state.communityDraft = "";
      state.communityKudosOpen = false;
      state.communityComposerOpen = false;
    }
    state.communityCharacterId = id;
    state.communityLoading = true;
    state.communityError = "";
    if (!quiet) renderProfile();
    try {
      const payload = await datacatFetch(
        `/characters/${encodeURIComponent(id)}/community?limit=40`,
      );
      if (
        communitySerial !== state.communitySerial ||
        state.communityCharacterId !== id
      ) {
        return;
      }
      state.community = payload.community || {
        kudos: { total: 0, gifts: [] },
        comments: { total: 0, items: [] },
        canInteract: false,
      };
    } catch (error) {
      if (
        communitySerial !== state.communitySerial ||
        state.communityCharacterId !== id
      ) {
        return;
      }
      state.communityError = publicErrorMessage(
        error,
        "Could not load kudos and comments.",
      );
    } finally {
      if (
        communitySerial !== state.communitySerial ||
        state.communityCharacterId !== id
      ) {
        return;
      }
      state.communityLoading = false;
      renderProfile();
    }
  }

  async function ensureCommunityAccount() {
    await loadAccountState({ force: true });
    if (
      state.accountState === "logged_in" &&
      state.linkedAccount
    ) {
      return true;
    }
    await linkAccount({ requireAccount: true });
    await loadAccountState({ force: true });
    const loggedIn =
      state.accountState === "logged_in" &&
      Boolean(state.linkedAccount);
    if (!loggedIn) {
      state.communityError =
        "Log in to Datacat to give kudos or comment.";
      renderProfile();
    }
    return loggedIn;
  }

  function sendNativeToast(tone, message, title = "Datacat") {
    const safeTone = ["success", "error", "info", "warning"].includes(tone)
      ? tone
      : "info";
    const safeMessage = String(message || "").trim().slice(0, 500);
    if (!safeMessage) return;
    try {
      ctx.sendToBackend({
        type: "datacat_toast",
        tone: safeTone,
        title: String(title || "Datacat").trim().slice(0, 80),
        message: safeMessage,
      });
    } catch (_) {}
  }

  async function giveCharacterKudos(giftKey) {
    const characterId = normalizeId(state.selected?.id);
    if (!characterId || state.communitySubmitting) return;
    const normalizedGiftKey = String(giftKey || "")
      .trim()
      .toLowerCase()
      .slice(0, 80);
    const options = Array.isArray(state.community?.kudos?.options)
      ? state.community.kudos.options
      : [];
    const gift = options.find(
      (option) =>
        String(option?.key || "").trim().toLowerCase() ===
        normalizedGiftKey,
    );
    if (!gift) {
      state.communityError =
        "That kudos choice is unavailable. Refresh and try again.";
      renderProfile();
      return;
    }
    if (!(await ensureCommunityAccount())) return;
    state.communitySubmitting = `kudos:${normalizedGiftKey}`;
    state.communityError = "";
    renderProfile();
    try {
      const payload = await datacatFetch(
        `/characters/${encodeURIComponent(characterId)}/community/kudos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ giftKey: normalizedGiftKey }),
        },
      );
      if (state.communityCharacterId !== characterId) return;
      state.community = payload.community || state.community;
      state.communityKudosOpen = false;
      sendNativeToast(
        "success",
        `${gift.emoji || "♥"} ${gift.label || "Kudos"} sent.`,
        "Kudos sent",
      );
    } catch (error) {
      if (state.communityCharacterId !== characterId) return;
      state.communityError = publicErrorMessage(error, "Could not give kudos.");
    } finally {
      if (state.communityCharacterId !== characterId) return;
      state.communitySubmitting = "";
      renderProfile();
    }
  }

  async function openCommunityComposer() {
    const characterId = normalizeId(state.selected?.id);
    if (!characterId || state.communitySubmitting) return;
    state.communityKudosOpen = false;
    state.communityComposerOpen = true;
    state.communityError = "";
    renderProfile();
    requestAnimationFrame(() =>
      modalHost.querySelector("[data-community-draft]")?.focus(),
    );
  }

  async function postCharacterComment() {
    const characterId = normalizeId(state.selected?.id);
    const body = state.communityDraft.trim().slice(0, 4000);
    if (!characterId || !body || state.communitySubmitting) return;
    if (!(await ensureCommunityAccount())) return;
    state.communitySubmitting = "comment";
    state.communityError = "";
    renderProfile();
    try {
      const payload = await datacatFetch(
        `/characters/${encodeURIComponent(characterId)}/community/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      if (state.communityCharacterId !== characterId) return;
      state.community = payload.community || state.community;
      state.communityDraft = "";
      state.communityComposerOpen = false;
      sendNativeToast(
        "success",
        "Your comment is now visible on Datacat.",
        "Comment posted",
      );
    } catch (error) {
      if (state.communityCharacterId !== characterId) return;
      state.communityError = publicErrorMessage(error, "Could not post your comment.");
    } finally {
      if (state.communityCharacterId !== characterId) return;
      state.communitySubmitting = "";
      renderProfile();
    }
  }

  async function openProfile(id) {
    const selectedSerial = ++state.selectedSerial;
    const summary = findCharacterById(id) || null;
    state.selected = null;
    state.selectedLoading = true;
    state.selectedError = "";
    state.communitySerial += 1;
    state.community = null;
    state.communityCharacterId = normalizeId(id);
    state.communityLoading = true;
    state.communityError = "";
    state.communitySubmitting = "";
    state.communityKudosOpen = false;
    state.communityComposerOpen = false;
    state.communityDraft = "";
    renderProfile();
    // Full view is the default: start loading the full card right from the tap.
    // Without a valid security check this opens the verification window here,
    // inside the click, so browsers allow the pop-up. Skipped only if the user
    // already closed that window this session; the button is still there.
    if (getVerificationLease() || !state.verificationDeclined) {
      void loadCardPreview(normalizeId(id));
    }
    void loadCharacterCommunity(id, { quiet: true });
    try {
      const profilePath = characterClientPath(summary || { id }, "profile");
      const payload = await datacatFetch(profilePath);
      if (selectedSerial !== state.selectedSerial) return;
      state.selected = { ...summary, ...(payload.character || {}), id };
      console.debug(
        "[Datacat] profile fields:",
        Object.keys(payload.character || {}).sort().join(", "),
      );
    } catch (error) {
      if (selectedSerial !== state.selectedSerial) return;
      state.selectedError = publicErrorMessage(error, "Could not load profile.");
      setStatus(state.selectedError, true);
    } finally {
      if (selectedSerial !== state.selectedSerial) return;
      state.selectedLoading = false;
      renderProfile();
    }
  }

  async function openCreator(creatorRef) {
    const ref = String(creatorRef || "").trim().toLowerCase();
    if (!ref || state.creatorLoading) return;
    state.selectedSerial += 1;
    state.selected = null;
    state.selectedLoading = false;
    state.selectedError = "";
    state.selectedCreator = null;
    state.selectedCreatorRef = ref;
    state.creatorCharacters = [];
    state.creatorOffset = 0;
    state.creatorHasMore = false;
    state.creatorError = "";
    state.creatorTagSlugs = new Set();
    state.creatorLoading = true;
    renderProfile();
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: "0",
        sort: "creation_date",
        sortDir: "desc",
      });
      const payload = await datacatFetch(
        `/creators/${encodeURIComponent(ref)}/bootstrap?${params}`,
      );
      state.selectedCreator = payload.creator || null;
      state.creatorCharacters = Array.isArray(payload.characters)
        ? payload.characters
        : [];
      state.creatorOffset = Number(
        payload.paging?.nextOffset ?? state.creatorCharacters.length,
      );
      state.creatorHasMore = payload.paging?.hasMore === true;
      if (!state.selectedCreator) {
        throw new Error("Datacat returned no usable creator profile.");
      }
    } catch (error) {
      state.creatorError = publicErrorMessage(error, "Could not load creator.");
      setStatus(state.creatorError, true);
    } finally {
      state.creatorLoading = false;
      renderProfile();
    }
  }

  async function loadCreatorCharacters({ reset = false } = {}) {
    if (
      !state.selectedCreatorRef ||
      state.creatorLoading ||
      state.creatorLoadingMore
    ) return;
    if (reset) {
      state.creatorLoading = true;
      state.creatorHasMore = false;
      const creatorScroll = profileHost.querySelector(
        "[data-creator-scroll]",
      );
      if (creatorScroll) creatorScroll.scrollTop = 0;
    } else {
      state.creatorLoadingMore = true;
    }
    state.creatorError = "";
    renderProfile();
    try {
      const offset = reset ? 0 : state.creatorOffset;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: "creation_date",
        sortDir: "desc",
      });
      if (state.creatorTagSlugs.size) {
        params.set("tagSlugs", [...state.creatorTagSlugs].join(","));
      }
      const payload = await datacatFetch(
        `/creators/${encodeURIComponent(state.selectedCreatorRef)}/characters?${params}`,
      );
      const rows = Array.isArray(payload.characters)
        ? payload.characters
        : [];
      state.creatorCharacters = reset
        ? rows
        : [...state.creatorCharacters, ...rows];
      state.creatorOffset = Number(
        payload.paging?.nextOffset ?? offset + rows.length,
      );
      state.creatorHasMore = payload.paging?.hasMore === true;
    } catch (error) {
      state.creatorError =
        publicErrorMessage(error, "Could not load this creator’s characters.");
    } finally {
      state.creatorLoading = false;
      state.creatorLoadingMore = false;
      renderProfile();
    }
  }

  function normalizeHostedClientUrl(value, expectedPath) {
    try {
      const url = new URL(String(value || ""));
      const expectedOrigin = new URL(apiOrigin());
      if (url.username || url.password || url.pathname !== expectedPath) {
        return "";
      }
      if (url.origin !== expectedOrigin.origin) return "";
      return url.href;
    } catch (_) {
      return "";
    }
  }

  function normalizeVerificationUrl(value) {
    return normalizeHostedClientUrl(value, "/client-verify");
  }

  function closeVerificationPopup(popup) {
    try {
      if (popup && !popup.closed) popup.close();
    } catch (_) {}
  }

  function verificationPopupBlockedError() {
    const error = new Error(
      "Allow pop-ups for Lumiverse and try again.",
    );
    error.code = "VERIFICATION_POPUP_BLOCKED";
    return error;
  }

  function verificationRetryRequiredError() {
    const error = new Error(
      "Verification expired. Try again.",
    );
    error.code = "VERIFICATION_RETRY_REQUIRED";
    return error;
  }

  function verificationPopupWaitingUrl() {
    const url = new URL("/client-verify", apiOrigin());
    url.searchParams.set("waiting", "1");
    url.searchParams.set("client", "Lumiverse");
    return url.toString();
  }

  function cancelImportVerification() {
    verificationGeneration += 1;
    window.clearTimeout(verificationPollTimer);
    verificationPollTimer = 0;
    closeVerificationPopup(activeVerificationPopup);
    activeVerificationPopup = null;
    const reject = verificationReject;
    verificationReject = null;
    if (reject) {
      const error = new Error("Datacat security check cancelled.");
      error.code = "VERIFICATION_CANCELLED";
      reject(error);
    }
  }

  async function startImportVerification(requestedName, popup = null) {
    const generation = ++verificationGeneration;
    if (!popup || popup.closed) {
      throw verificationPopupBlockedError();
    }
    activeVerificationPopup = popup;
    try {
      const payload = await datacatFetch("/verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: VERIFICATION_ACTION,
          clientName: "Lumiverse",
          clientVersion: VERSION,
        }),
      });
      const verificationUrl = normalizeVerificationUrl(
        payload.verificationUriComplete,
      );
      if (!verificationUrl) {
        throw new Error(
          "Datacat returned an invalid security-check address.",
        );
      }
      try {
        if (popup.closed) throw verificationPopupBlockedError();
        popup.location.replace(verificationUrl);
        popup.focus();
      } catch (_) {
        throw verificationPopupBlockedError();
      }
      activeVerificationPopup = popup;
      setStatus("");
      setImportFeedback({
        tone: "verification",
        title: "Verification required",
        detail: "Complete the Cloudflare check.",
      });
      render();

      const deadline =
        Date.now() + Number(payload.expiresIn || 300) * 1000;
      const lease = await new Promise((resolve, reject) => {
        verificationReject = reject;
        const schedulePoll = () => {
          if (generation !== verificationGeneration) return;
          verificationPollTimer = window.setTimeout(() => {
            verificationPollTimer = 0;
            void poll();
          }, Math.max(1, Number(payload.interval || 3)) * 1000);
        };
        const poll = async () => {
          if (generation !== verificationGeneration) return;
          if (Date.now() >= deadline) {
            reject(new Error("The Datacat security-check request expired."));
            return;
          }
          try {
            const statusPayload = await datacatFetch(
              `/verifications/${encodeURIComponent(
                payload.verificationId,
              )}`,
            );
            const verificationStatus = String(
              statusPayload.verification?.status || "",
            ).toLowerCase();
            if (generation !== verificationGeneration) return;
            if (verificationStatus === "pending") {
              if (activeVerificationPopup?.closed) {
                const closed = new Error("Datacat verification cancelled.");
                closed.code = "VERIFICATION_WINDOW_CLOSED";
                reject(closed);
                return;
              }
              schedulePoll();
              return;
            }
            if (verificationStatus !== "verified") {
              throw new Error(
                verificationStatus === "exchanged"
                  ? "This Datacat security check was already used."
                  : "This Datacat security check is no longer available.",
              );
            }
            const token = await datacatFetch(
              `/verifications/${encodeURIComponent(
                payload.verificationId,
              )}/token`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              },
            );
            if (!token.leaseAvailable || !token.expiresAt) {
              reject(
                new Error(
                  "Datacat returned no usable security-check lease.",
                ),
              );
              return;
            }
            resolve({
              expiresAt: token.expiresAt,
            });
          } catch (error) {
            if (error.code === "VERIFICATION_PENDING") {
              schedulePoll();
              return;
            }
            reject(error);
          }
        };
        void poll();
      });
      setVerificationLease(lease);
      closeVerificationPopup(activeVerificationPopup);
      setStatus("");
      render();
      return lease;
    } catch (error) {
      closeVerificationPopup(activeVerificationPopup);
      throw error;
    } finally {
      window.clearTimeout(verificationPollTimer);
      verificationPollTimer = 0;
      verificationReject = null;
      activeVerificationPopup = null;
    }
  }

  async function ensureImportVerification(
    requestedName,
    popup = null,
  ) {
    const existing = getVerificationLease();
    if (existing) {
      return existing;
    }
    if (verificationPromise) {
      closeVerificationPopup(popup);
      return verificationPromise;
    }
    verificationPromise = startImportVerification(
      requestedName,
      popup,
    );
    try {
      return await verificationPromise;
    } finally {
      verificationPromise = null;
    }
  }

  async function withImportVerification(
    requestedName,
    popup,
    transfer,
  ) {
    let lease = await ensureImportVerification(requestedName, popup);
    try {
      return await transfer();
    } catch (error) {
      if (!error.verificationRequired) throw error;
      setVerificationLease(null);
      if (!popup || popup.closed) {
        throw verificationRetryRequiredError();
      }
      lease = await ensureImportVerification(requestedName, popup);
      return transfer();
    }
  }

  // Lumiverse auto-imports an embedded character_book when it creates the
  // character. This call is an idempotent safety net: it returns the already
  // linked world book, or creates and links one if the auto-import was skipped.
  async function confirmLorebookImport(lumiverseCharacterId, expectedEntries) {
    const plural = (count) => `${count} ${count === 1 ? "entry" : "entries"}`;
    try {
      const response = await fetch("/api/v1/world-books/import-character-book", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ characterId: lumiverseCharacterId }),
      });
      const result = await readJson(response);
      const count = Number(result?.entry_count) || expectedEntries;
      return `Lorebook imported and linked · ${plural(count)}`;
    } catch (_) {
      return `The card includes a lorebook (${plural(expectedEntries)}) but it could not be linked automatically. Import it from the character's World Books.`;
    }
  }

  // Preview the full card (greeting, scenario, images in the description).
  // The card is a protected transfer, so this only runs on an explicit click
  // and goes through the same Datacat security check as an import.
  async function loadCardPreview(id, { manual = false } = {}) {
    if (!id || state.importId || state.cardLoading.has(id) || state.cardCache.has(id)) return;
    if (manual) state.verificationDeclined = false;
    const summary = findCharacterById(id) || state.selected;
    const requestedName = summary?.name || "character";
    const existingLease = getVerificationLease();
    // One security-check window at a time.
    if (!existingLease && state.cardLoading.size) return;
    const popup = existingLease
      ? null
      : window.open(
          verificationPopupWaitingUrl(),
          "datacat-client-verification",
          "popup=yes,width=560,height=720",
        );
    state.cardErrors.delete(id);
    if (!existingLease && !popup) {
      state.verificationDeclined = true;
      state.cardErrors.set(
        id,
        publicErrorMessage(
          verificationPopupBlockedError(),
          "Allow pop-ups for Lumiverse to complete the Datacat security check.",
        ),
      );
      render();
      return;
    }
    state.cardLoading.add(id);
    render();
    try {
      const transfer = await resolveImportTransferContract(summary || { id }, id);
      const card = await withImportVerification(requestedName, popup, () =>
        datacatFetch(transfer.cardPath),
      );
      if (!card || typeof card !== "object") {
        throw new Error("Datacat returned an empty card.");
      }
      state.cardCache.set(id, card);
    } catch (error) {
      const cancelled =
        error?.code === "VERIFICATION_CANCELLED" ||
        error?.code === "VERIFICATION_WINDOW_CLOSED";
      // Don't re-open the check on every tap after the user backed out.
      if (cancelled) state.verificationDeclined = true;
      state.cardErrors.set(
        id,
        cancelled
          ? "Security check was not completed. Try again when you're ready."
          : error?.retryAfter
            ? `${publicErrorMessage(error, "Could not load the full card.")} Retry in ${error.retryAfter}s.`
            : publicErrorMessage(error, "Could not load the full card."),
      );
    } finally {
      closeVerificationPopup(popup);
      if (state.importFeedback?.tone === "verification") setImportFeedback(null);
      state.cardLoading.delete(id);
      render();
    }
  }

  async function importCharacter(id) {
    if (!id || state.importId || state.cardLoading.size) return;
    const existingCharacterId = savedLumiverseId(id);
    if (existingCharacterId) {
      setImportFeedback({
        tone: "success",
        title: "Already in Lumiverse",
        datacatCharacterId: id,
        lumiverseCharacterId: existingCharacterId,
      });
      return;
    }
    const summary = findCharacterById(id) || state.selected;
    const requestedName = summary?.name || "character";
    let lumiverseCharacter = null;
    const existingLease = getVerificationLease();
    const verificationPopup = existingLease
      ? null
      : window.open(
          verificationPopupWaitingUrl(),
          "datacat-client-verification",
          "popup=yes,width=560,height=720",
        );
    if (!existingLease && !verificationPopup) {
      const error = verificationPopupBlockedError();
      const message = publicErrorMessage(
        error,
        "Allow pop-ups for Lumiverse to complete the Datacat security check.",
      );
      setStatus(message, true);
      setImportFeedback({
        tone: "error",
        title: `Could not import ${requestedName}`,
        detail: message,
        datacatCharacterId: id,
      });
      return;
    }
    state.importId = id;
    setStatus(`Importing ${requestedName}…`);
    setImportFeedback({
      tone: "progress",
      title: `Importing ${requestedName}…`,
      datacatCharacterId: id,
    });
    render();
    try {
      const transfer = await resolveImportTransferContract(
        summary || { id },
        id,
      );
      // Reuse a card already loaded for the preview; import mutates it.
      const previewedCard = state.cardCache.get(id);
      const card = previewedCard
        ? structuredClone(previewedCard)
        : await withImportVerification(
            requestedName,
            verificationPopup,
            () => datacatFetch(transfer.cardPath),
          );
      const importedAt = new Date().toISOString();
      ensureBookInExtensions(card);
      const lorebookEntries = lorebookEntryCount(findCharacterBook(card));
      const profileListsLorebook = profileLorebookInfo(transfer.character).has;
      if (card && typeof card === "object") {
        card.extensions = {
          ...(card.extensions && typeof card.extensions === "object"
            ? card.extensions
            : {}),
          datacat: {
            ...(card.extensions?.datacat &&
            typeof card.extensions.datacat === "object"
              ? card.extensions.datacat
              : {}),
            importedAt,
          },
        };
      }
      const avatarFile = await withImportVerification(
        requestedName,
        verificationPopup,
        () => downloadMirroredAvatar(
          transfer.character,
          transfer.avatarPath,
        ),
      );
      closeVerificationPopup(verificationPopup);

      const importResponse = await fetch("/api/v1/characters/import", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(card),
      });
      const result = await readJson(importResponse);
      lumiverseCharacter = result?.character || null;
      if (!lumiverseCharacter?.id) {
        throw new Error("Lumiverse created no usable character record.");
      }
      state.savedCharacters.set(id, lumiverseCharacter.id);
      state.savedLoaded = true;

      const avatarForm = new FormData();
      avatarForm.append("avatar", avatarFile);
      const avatarResponse = await fetch(
        `/api/v1/characters/${encodeURIComponent(lumiverseCharacter.id)}/avatar`,
        {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
          body: avatarForm,
        },
      );
      const avatarCharacter = await readJson(avatarResponse);
      if (avatarCharacter?.id) lumiverseCharacter = avatarCharacter;

      const name = lumiverseCharacter?.name || requestedName;
      upsertImportRecord({
        datacatCharacterId: id,
        lumiverseCharacterId: lumiverseCharacter.id,
        name,
        importedAt,
      });
      let lorebookDetail = "";
      if (lorebookEntries > 0) {
        lorebookDetail = await confirmLorebookImport(
          lumiverseCharacter.id,
          lorebookEntries,
        );
      } else if (profileListsLorebook) {
        lorebookDetail =
          "Datacat lists a lorebook for this character, but it was not included in the card Datacat served.";
      }
      setStatus("");
      setImportFeedback({
        tone: "success",
        title: `${name} imported to Lumiverse`,
        detail: lorebookDetail,
        datacatCharacterId: id,
        lumiverseCharacterId: lumiverseCharacter.id,
      });
      ctx.events.emit("datacat-character-imported", {
        character: lumiverseCharacter,
        datacatCharacterId: id,
      });
    } catch (error) {
      closeVerificationPopup(verificationPopup);
      const cancelled = [
        "VERIFICATION_CANCELLED",
        "VERIFICATION_WINDOW_CLOSED",
      ].includes(error.code);
      const message = cancelled
        ? "Import cancelled before the Datacat security check was completed."
        : error.retryAfter
          ? `${publicErrorMessage(error, "Import failed.")} Retry in ${error.retryAfter}s.`
          : publicErrorMessage(error, "Import failed.");
      setStatus(message, true);
      setImportFeedback({
        tone: "error",
        title: cancelled
          ? `Import of ${requestedName} cancelled`
          : lumiverseCharacter?.id
          ? `${lumiverseCharacter.name || requestedName} was added without its image`
          : `Could not import ${requestedName}`,
        detail: lumiverseCharacter?.id
          ? `${message} Open the character to review it; retrying the full import could create a duplicate.`
          : message,
        retryLabel:
          error.code === "VERIFICATION_RETRY_REQUIRED"
            ? "Continue with security check"
            : "",
        datacatCharacterId: lumiverseCharacter?.id ? "" : id,
        lumiverseCharacterId: lumiverseCharacter?.id || "",
      });
    } finally {
      closeVerificationPopup(verificationPopup);
      state.importId = "";
      render();
    }
  }

  async function loadAccountState({ force = false } = {}) {
    if (accountStatePromise) return accountStatePromise;
    if (
      !force &&
      accountLoadedAt &&
      Date.now() - accountLoadedAt < 5000
    ) {
      return state.accountState;
    }
    accountStatePromise = (async () => {
      try {
        const payload = await datacatFetch("/account/status");
        state.linkedAccount = payload.account || null;
        state.accountState =
          payload.accountState === "logged_in" &&
          state.linkedAccount
            ? "logged_in"
            : payload.accountState === "linked_anonymous"
              ? "linked_anonymous"
              : "unlinked";
      } catch (error) {
        state.linkedAccount = null;
        state.accountState = "unlinked";
      } finally {
        accountLoadedAt = Date.now();
        render();
      }
      return state.accountState;
    })();
    try {
      return await accountStatePromise;
    } finally {
      accountStatePromise = null;
    }
  }

  function applySecureState(secureState = {}) {
    setVerificationLease(
      secureState?.verificationExpiresAt
        ? { expiresAt: secureState.verificationExpiresAt }
        : null,
    );
  }

  async function linkAccount({
    requireAccount = false,
    forceLogin = false,
    forceAnonymous = false,
  } = {}) {
    if (state.accountLinking) return;
    state.accountLinking = true;
    render();
    await loadAccountState({ force: true });
    if (
      state.accountState !== "unlinked" &&
      !requireAccount &&
      !forceAnonymous
    ) {
      state.accountLinking = false;
      render();
      return;
    }
    let popup = null;
    let cancelled = false;
    setStatus(
      "Connecting…",
    );
    try {
      const payload = await datacatFetch("/account-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: "Lumiverse",
          clientVersion: VERSION,
        }),
      });
      let accountLinkUrl = normalizeHostedClientUrl(
        payload.authorizationUriComplete ||
          payload.verificationUriComplete,
        "/client-link",
      );
      if (!accountLinkUrl) {
        throw new Error(
          "Datacat returned an invalid account-link address.",
        );
      }
      if (requireAccount) {
        const loginUrl = new URL(accountLinkUrl);
        loginUrl.searchParams.set("login", "1");
        if (forceLogin) loginUrl.searchParams.set("switch", "1");
        accountLinkUrl = loginUrl.href;
      } else if (forceAnonymous) {
        const anonymousUrl = new URL(accountLinkUrl);
        anonymousUrl.searchParams.set("anonymous", "1");
        accountLinkUrl = anonymousUrl.href;
      }
      popup = window.open(
        accountLinkUrl,
        "datacat-account-link",
        "popup=yes,width=560,height=720",
      );
      if (!popup) {
        throw new Error(`Open ${accountLinkUrl} to approve the link.`);
      }
      setStatus(
        requireAccount ? "Log in to continue…" : "Connecting…",
      );
      const deadline = Date.now() + Number(payload.expiresIn || 600) * 1000;
      await new Promise((resolve, reject) => {
        const poll = async () => {
          if (Date.now() >= deadline) {
            reject(new Error("The Datacat linking code expired."));
            return;
          }
          try {
            const token = await datacatFetch(
              `/account-links/${encodeURIComponent(payload.linkId)}/token`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              },
            );
            setVerificationLease(null);
            state.linkedAccount = token.account || null;
            state.accountState =
              token.accountState === "logged_in" &&
              state.linkedAccount
                ? "logged_in"
                : "linked_anonymous";
            popup.close();
            resolve();
          } catch (error) {
            if (error.code !== "LINK_PENDING") {
              reject(error);
              return;
            }
            if (popup.closed) {
              const closed = new Error("Account login cancelled.");
              closed.code = "LINK_WINDOW_CLOSED";
              reject(closed);
              return;
            }
            linkPollTimer = window.setTimeout(poll, Number(payload.interval || 3) * 1000);
          }
        };
        poll();
      });
      accountLoadedAt = 0;
      await loadAccountState({ force: true });
      const linkedName =
        state.linkedAccount?.displayName ||
        state.linkedAccount?.username ||
        (state.accountState === "linked_anonymous"
          ? "Anonymous"
          : "Datacat");
      setStatus(`Connected · ${linkedName}`);
    } catch (error) {
      cancelled = error.code === "LINK_WINDOW_CLOSED";
      const message =
        error.code === "CLIENT_API_SCHEMA_REQUIRED"
          ? "Datacat account linking is temporarily unavailable. Character imports still work without linking."
          : cancelled
            ? "Cancelled."
            : publicErrorMessage(error, "Could not link Datacat account.");
      setStatus(message, true);
    } finally {
      window.clearTimeout(linkPollTimer);
      linkPollTimer = 0;
      state.accountLinking = false;
      render();
      if (cancelled) updateCatalogStatus();
    }
  }

  async function logoutAccount() {
    if (state.accountLinking) return;
    state.accountLinking = true;
    setMenuOpen(false);
    render();
    try {
      await datacatFetch("/account", { method: "DELETE" });
      state.linkedAccount = null;
      state.accountState = "unlinked";
      setVerificationLease(null);
      accountLoadedAt = Date.now();
      setStatus("Logged out.");
    } catch (error) {
      setStatus(publicErrorMessage(error, "Could not log out."), true);
    } finally {
      state.accountLinking = false;
      render();
    }
  }

  root.addEventListener("input", (event) => {
    if (event.target === search) {
      state.query = search.value.trim().slice(0, 120);
      searchClear.hidden = !state.query;
      scheduleBrowserStateSave();
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(
        () => loadCharacters({ reset: true }),
        300,
      );
      return;
    }
    if (event.target === tagSearch) {
      state.tagQuery = tagSearch.value.trim().slice(0, 80);
      scheduleBrowserStateSave();
      window.clearTimeout(tagSearchTimer);
      tagSearchTimer = window.setTimeout(
        () => loadTags({ reset: true }),
        250,
      );
    }
  });
  modalHost.addEventListener("input", (event) => {
    const target =
      event.target instanceof HTMLTextAreaElement
        ? event.target
        : null;
    if (!target?.matches("[data-community-draft]")) return;
    state.communityDraft = target.value.slice(0, 4000);
    const submit = modalHost.querySelector(
      "[data-community-comment-submit]",
    );
    if (submit instanceof HTMLButtonElement) {
      submit.disabled =
        !state.communityDraft.trim() ||
        state.communitySubmitting === "comment";
    }
  });

  function handleSurfaceClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const openLightbox = modalHost.querySelector(".dcv1-lightbox");
    if (openLightbox) {
      openLightbox.remove();
      if (!target.closest("[data-lightbox-src]")) return;
    }
    const lightboxSource = target.closest("[data-lightbox-src]");
    if (lightboxSource) {
      const url = lightboxSource.getAttribute("data-lightbox-src") || "";
      if (/^https?:\/\//i.test(url)) {
        event.preventDefault();
        const box = document.createElement("div");
        box.className = "dcv1-lightbox";
        box.tabIndex = -1;
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-label", "Image preview");
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        box.append(img);
        modalHost.append(box);
        box.focus({ preventScroll: true });
      }
      return;
    }
    const loadCard = target.closest("[data-load-card]");
    if (loadCard) {
      void loadCardPreview(normalizeId(loadCard.getAttribute("data-load-card")), {
        manual: true,
      });
      return;
    }
    const cardTabButton = target.closest("[data-card-tab]");
    if (cardTabButton) {
      state.cardTabChoice.set(
        normalizeId(cardTabButton.getAttribute("data-card-id")),
        cardTabButton.getAttribute("data-card-tab"),
      );
      renderCharacterModal();
      return;
    }
    if (target.closest("[data-sort-toggle]")) {
      if (!state.catalogSortLoading) setCatalogSortOpen(catalogSortMenu.hidden);
      return;
    }
    const sortOption = target.closest("[data-sort-option]");
    if (sortOption) {
      const nextSort = normalizeCatalogSort(
        sortOption.getAttribute("data-sort-option"),
      );
      setCatalogSortOpen(false);
      if (nextSort === state.catalogSort) return;
      if (state.catalogSortLoading || state.loading || state.loadingMore) return;
      state.catalogSort = nextSort;
      state.catalogSortLoading = true;
      syncCatalogSortControl();
      scheduleBrowserStateSave();
      catalogScroll.scrollTop = 0;
      void loadCharacters({ reset: true }).finally(() => {
        state.catalogSortLoading = false;
        render();
      });
      return;
    }
    const viewModeButton = target.closest("[data-view-mode]");
    if (viewModeButton) {
      const requestedMode = String(
        viewModeButton.getAttribute("data-view-mode") || "",
      );
      const nextMode = ["fresh", "catalog", "imports"].includes(
        requestedMode,
      )
        ? requestedMode
        : "fresh";
      if (nextMode === state.viewMode) return;
      state.viewMode = nextMode;
      state.tagPanelOpen = false;
      setCatalogSortOpen(false);
      catalogScroll.scrollTop = 0;
      render();
      if (
        nextMode === "fresh" &&
        freshCharacterCount() === 0 &&
        !state.freshLoading
      ) {
        void loadFreshCharacters({ reset: true });
      } else if (
        nextMode === "catalog" &&
        state.characters.length === 0 &&
        !state.loading
      ) {
        void Promise.all([
          state.tags.length
            ? Promise.resolve()
            : loadTags({ reset: true }),
          loadCharacters({ reset: true }),
        ]);
      } else if (nextMode === "imports" && !state.savedLoaded) {
        void loadSavedCharacters();
      } else {
        updateCatalogStatus();
      }
      return;
    }
    if (target.closest("[data-tags-close]")) {
      state.tagPanelOpen = false;
      syncTagPanelVisibility();
      tagsToggle.focus();
      return;
    }
    if (target.closest("[data-catalog-sentinel]")) {
      if (
        state.viewMode === "fresh" &&
        state.freshLoadMoreError
      ) {
        void loadFreshCharacters();
      } else if (
        state.viewMode === "catalog" &&
        state.loadMoreError
      ) {
        void loadCharacters();
      }
      return;
    }
    if (
      target.closest("[data-creator-sentinel]") &&
      state.creatorError &&
      state.creatorHasMore
    ) {
      void loadCreatorCharacters();
      return;
    }
    if (target.closest("[data-tags-toggle]")) {
      if (state.viewMode !== "catalog") {
        state.viewMode = "catalog";
        catalogScroll.scrollTop = 0;
        render();
        if (state.characters.length === 0 && !state.loading) {
          void loadCharacters({ reset: true });
        }
      }
      state.tagPanelOpen = !state.tagPanelOpen;
      if (state.tagPanelOpen) tagGroups.scrollTop = 0;
      if (state.tagPanelOpen && state.tags.length === 0) {
        void loadTags({ reset: true });
      }
      syncTagPanelVisibility();
      if (state.tagPanelOpen) {
        requestAnimationFrame(() => {
          tagGroups.scrollTop = 0;
          tagSearch.focus({ preventScroll: true });
        });
      }
      return;
    }
    const tagButton = target.closest("[data-tag-id]");
    if (tagButton) {
      const tagId = Number(tagButton.getAttribute("data-tag-id"));
      const next = new Set(state.selectedTagIds);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      void updateSelectedTags(next);
      return;
    }
    const removeTagButton = target.closest("[data-tag-remove]");
    if (removeTagButton) {
      const tagId = Number(removeTagButton.getAttribute("data-tag-remove"));
      const next = new Set(state.selectedTagIds);
      next.delete(tagId);
      void updateSelectedTags(next);
      return;
    }
    if (target.closest("[data-tags-clear]")) {
      void updateSelectedTags(new Set());
      return;
    }
    if (target.closest("[data-tag-sort]")) {
      state.tagSort = state.tagSort === "count" ? "alpha" : "count";
      void loadTags({ reset: true });
      return;
    }
    const tagViewButton = target.closest("[data-tag-view]");
    if (tagViewButton) {
      state.tagView =
        tagViewButton.getAttribute("data-tag-view") === "list"
          ? "list"
          : "cloud";
      saveTagViewMode(state.tagView);
      tagGroups.scrollTop = 0;
      renderTagBrowser();
      return;
    }
    if (target.closest("[data-tag-retry]")) {
      void loadTags({ reset: true });
      return;
    }
    if (
      target.closest("[data-tag-sentinel]") &&
      state.tagError &&
      state.tagHasMore
    ) {
      void loadTags();
      return;
    }
    const creatorTag = target.closest("[data-creator-tag-slug]");
    if (creatorTag) {
      const slug = String(
        creatorTag.getAttribute("data-creator-tag-slug") || "",
      ).trim();
      if (slug) {
        if (state.creatorTagSlugs.has(slug)) {
          state.creatorTagSlugs.delete(slug);
        } else {
          state.creatorTagSlugs.add(slug);
        }
        void loadCreatorCharacters({ reset: true });
      }
      return;
    }
    const characterTag = target.closest("[data-tag-name]");
    if (characterTag) {
      void selectTagByText(characterTag.getAttribute("data-tag-name"));
      return;
    }
    const creatorLink = target.closest("[data-creator-ref]");
    if (creatorLink) {
      event.preventDefault();
      event.stopPropagation();
      void openCreator(creatorLink.getAttribute("data-creator-ref"));
      return;
    }
    if (target.closest("[data-creator-back]")) {
      state.selectedCreator = null;
      state.selectedCreatorRef = "";
      state.creatorCharacters = [];
      state.creatorTagSlugs = new Set();
      state.creatorError = "";
      renderProfile();
      return;
    }
    if (target.closest("[data-menu-toggle]")) {
      const opening = menuPanel.hidden;
      if (opening) {
        render();
        void loadAccountState();
      }
      setMenuOpen(opening);
      return;
    }
    if (target.closest("[data-close-drawer]")) {
      closeDatacatDrawer();
      return;
    }
    if (target.closest("[data-login-account]")) {
      setMenuOpen(false);
      void linkAccount({
        requireAccount: true,
        forceLogin: state.accountState === "logged_in",
      });
      return;
    }
    if (target.closest("[data-account-choice]")) {
      state.accountChoiceOpen = true;
      render();
      setMenuOpen(true);
      return;
    }
    if (target.closest("[data-connect-anonymous]")) {
      setMenuOpen(false);
      void linkAccount({ forceAnonymous: true });
      return;
    }
    if (target.closest("[data-connect-login]")) {
      setMenuOpen(false);
      void linkAccount({
        requireAccount: true,
        forceLogin: true,
      });
      return;
    }
    if (target.closest("[data-logout-account]")) {
      void logoutAccount();
      return;
    }
    if (target.closest("[data-community-retry]")) {
      void loadCharacterCommunity(state.selected?.id);
      return;
    }
    const kudosGiftButton = target.closest("[data-community-gift]");
    if (kudosGiftButton) {
      void giveCharacterKudos(
        kudosGiftButton.getAttribute("data-community-gift"),
      );
      return;
    }
    if (target.closest("[data-community-kudos]")) {
      state.communityKudosOpen = !state.communityKudosOpen;
      state.communityComposerOpen = false;
      state.communityError = "";
      renderProfile();
      if (state.communityKudosOpen) {
        requestAnimationFrame(() =>
          modalHost.querySelector("[data-community-gift]")?.focus(),
        );
      }
      return;
    }
    if (target.closest("[data-community-kudos-close]")) {
      state.communityKudosOpen = false;
      renderProfile();
      return;
    }
    if (target.closest("[data-community-comment-open]")) {
      void openCommunityComposer();
      return;
    }
    if (target.closest("[data-community-comment-cancel]")) {
      state.communityComposerOpen = false;
      state.communityDraft = "";
      state.communityError = "";
      renderProfile();
      return;
    }
    if (target.closest("[data-community-comment-submit]")) {
      void postCharacterComment();
      return;
    }
    const retryProfile = target.closest("[data-retry-profile]");
    if (retryProfile) {
      void openProfile(retryProfile.getAttribute("data-retry-profile"));
      return;
    }
    const chatImport = target.closest("[data-chat-import]");
    if (chatImport) {
      event.preventDefault();
      event.stopPropagation();
      if (chatImport.closest("[data-import-tray]")) {
        setImportFeedback(null);
        closeCharacterModal();
      }
      void openOrCreateLumiverseChat(
        chatImport.getAttribute("data-chat-import"),
        chatImport,
      );
      return;
    }
    const viewImport = target.closest("[data-view-import]");
    if (viewImport) {
      const characterId = normalizeId(viewImport.getAttribute("data-view-import"));
      if (characterId) {
        closeCharacterModal();
        void openLocalCharacterModal(characterId);
      }
      return;
    }
    if (target.closest("[data-dismiss-import]")) {
      setImportFeedback(null);
      return;
    }
    const retryImport = target.closest("[data-retry-import]");
    if (retryImport) {
      const characterId = normalizeId(retryImport.getAttribute("data-retry-import"));
      setImportFeedback(null);
      void importCharacter(characterId);
      return;
    }
    const importButton = target.closest("[data-import]");
    if (importButton) {
      event.preventDefault();
      event.stopPropagation();
      void importCharacter(normalizeId(importButton.getAttribute("data-import")));
      return;
    }
    if (target.closest("[data-back]")) {
      closeCharacterModal();
      return;
    }
    if (target.closest("[data-refresh]")) {
      void refreshCatalog({ forceLibrary: true });
      return;
    }
    if (target.closest("[data-clear]")) {
      search.value = "";
      state.query = "";
      searchClear.hidden = true;
      scheduleBrowserStateSave();
      void loadCharacters({ reset: true });
      return;
    }
    if (target.matches("[data-character-backdrop]")) {
      closeCharacterModal();
      return;
    }
    const card = target.closest("[data-card]");
    if (card) void openProfile(normalizeId(card.getAttribute("data-card")));
  }

  function handleSurfaceKeydown(event) {
    if (event.key === "Escape") {
      const lightbox = modalHost.querySelector(".dcv1-lightbox");
      if (lightbox) {
        event.preventDefault();
        lightbox.remove();
        return;
      }
    }
    if (
      event.key === "Escape" &&
      (state.selected || state.selectedLoading || state.selectedError)
    ) {
      event.preventDefault();
      closeCharacterModal();
      return;
    }
    if (event.key === "Escape" && state.tagPanelOpen) {
      event.preventDefault();
      state.tagPanelOpen = false;
      syncTagPanelVisibility();
      tagsToggle.focus();
      return;
    }
    if (event.key === "Escape" && !menuPanel.hidden) {
      event.preventDefault();
      setMenuOpen(false);
      menuToggle.focus();
      return;
    }
    if (event.key === "Escape" && !catalogSortMenu.hidden) {
      event.preventDefault();
      setCatalogSortOpen(false);
      catalogSortToggle.focus();
      return;
    }
    if (!["Enter", " "].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("button,input,a")) return;
    const card = target.closest("[data-card]");
    if (!card) return;
    event.preventDefault();
    void openProfile(normalizeId(card.getAttribute("data-card")));
  }

  // Badges and icons keep their natural size; every other image fills the width.
  modalHost.addEventListener(
    "load",
    (event) => {
      const img = event.target;
      if (
        img instanceof HTMLImageElement &&
        img.classList.contains("dcv1-rich-img") &&
        img.naturalWidth > 0 &&
        img.naturalWidth < 180
      ) {
        img.dataset.small = "true";
      }
    },
    true,
  );
  root.addEventListener("click", handleSurfaceClick);
  modalHost.addEventListener("click", handleSurfaceClick);
  root.addEventListener("keydown", handleSurfaceKeydown);
  modalHost.addEventListener("keydown", handleSurfaceKeydown);
  root.addEventListener("click", scheduleBrowserStateSave);
  modalHost.addEventListener("click", scheduleBrowserStateSave);
  root.addEventListener("keydown", scheduleBrowserStateSave);
  modalHost.addEventListener("keydown", scheduleBrowserStateSave);
  catalogScroll.addEventListener("scroll", scheduleBrowserStateSave, {
    passive: true,
  });

  let raf = 0;
  let attempts = 0;
  let markedHost = null;
  let lumiversePanelHeader = null;
  let lumiversePanelContent = null;
  let lumiverseDrawerCloseButton = null;

  const clearDatacatHostFrame = () => {
    markedHost?.classList.remove("dcv1-host");
    lumiversePanelHeader?.classList.remove(
      "dcv1-lumiverse-panel-header",
    );
    lumiversePanelContent?.classList.remove(
      "dcv1-lumiverse-panel-content",
    );
    markedHost = null;
    lumiversePanelHeader = null;
    lumiversePanelContent = null;
    lumiverseDrawerCloseButton = null;
  };

  const markHost = () => {
    const host = tab.root.parentElement;
    if (!host || !tab.root.isConnected) {
      clearDatacatHostFrame();
      if (attempts++ < 30) raf = requestAnimationFrame(markHost);
      return;
    }
    if (markedHost && markedHost !== host) clearDatacatHostFrame();
    markedHost = host;
    host.classList.add("dcv1-host");

    let panelContent = host;
    while (panelContent && panelContent !== document.body) {
      const header = panelContent.previousElementSibling;
      const closeButton = header?.querySelector?.("button");
      if (header instanceof HTMLElement && header.querySelector("h2") && closeButton) {
        if (lumiversePanelHeader && lumiversePanelHeader !== header) {
          clearDatacatHostFrame();
          markedHost = host;
          host.classList.add("dcv1-host");
        }
        lumiversePanelHeader = header;
        lumiversePanelContent = panelContent;
        lumiverseDrawerCloseButton = closeButton;
        header.classList.add("dcv1-lumiverse-panel-header");
        panelContent.classList.add("dcv1-lumiverse-panel-content");
        break;
      }
      panelContent = panelContent.parentElement;
    }
  };

  function closeDatacatDrawer() {
    markHost();
    if (lumiverseDrawerCloseButton?.isConnected) {
      lumiverseDrawerCloseButton.click();
    }
  }

  const stopActivationWatch = tab.onActivate(() => {
    attempts = 0;
    markHost();
    if (Date.now() - state.savedLoadedAt > 15_000) {
      void loadSavedCharacters();
    }
    if (Date.now() - accountLoadedAt > 5000) {
      void loadAccountState({ force: true });
    }
  });
  const syncAccountAfterFocus = () => {
    if (
      !state.accountLinking &&
      Date.now() - accountLoadedAt > 5000
    ) {
      void loadAccountState({ force: true });
    }
  };
  const closeMenuAfterOutsidePointer = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      !catalogSortMenu.hidden &&
      (!target || !target.closest("[data-catalog-sort]"))
    ) {
      setCatalogSortOpen(false);
    }
    if (
      !menuPanel.hidden &&
      (!target || !target.closest(".dcv1-menu"))
    ) {
      setMenuOpen(false);
    }
  };

  let chatCommunityOpening = false;
  async function openCommunityForActiveChat(mode) {
    if (chatCommunityOpening) return;
    const activeChat = ctx.getActiveChat();
    const lumiverseCharacterId = normalizeId(activeChat?.characterId);
    if (!lumiverseCharacterId) {
      sendNativeToast(
        "info",
        "Open a character chat before using this action.",
      );
      return;
    }
    chatCommunityOpening = true;
    try {
      const link = await requestBackendCharacterLink(
        lumiverseCharacterId,
      );
      const datacatCharacterId = normalizeId(
        link?.datacatCharacterId,
      );
      if (!datacatCharacterId) {
        sendNativeToast(
          "info",
          "This chat character was not imported from Datacat.",
        );
        return;
      }
      await openProfile(datacatCharacterId);
      if (
        normalizeId(state.selected?.id) !== datacatCharacterId
      ) {
        sendNativeToast(
          "error",
          "Datacat could not open this character’s community page.",
        );
        return;
      }
      state.communityError = "";
      if (mode === "comment") {
        state.communityKudosOpen = false;
        state.communityComposerOpen = true;
      } else {
        state.communityComposerOpen = false;
        state.communityKudosOpen = true;
      }
      renderProfile();
      requestAnimationFrame(() => {
        modalHost
          .querySelector(
            mode === "comment"
              ? "[data-community-draft]"
              : "[data-community-gift]",
          )
          ?.focus();
      });
    } catch (error) {
      sendNativeToast(
        "error",
        publicErrorMessage(
          error,
          "Could not open Datacat community actions for this chat.",
        ),
      );
    } finally {
      chatCommunityOpening = false;
    }
  }

  const chatKudosAction = ctx.ui.registerInputBarAction({
    id: "datacat-kudos",
    label: "Kudos",
    subtitle: "Support this Datacat creator",
    iconSvg: KUDOS_ICON,
  });
  const chatCommentAction = ctx.ui.registerInputBarAction({
    id: "datacat-comment",
    label: "Comment",
    subtitle: "Comment on this Datacat character",
    iconSvg: COMMENT_ICON,
  });
  const stopChatKudosAction = chatKudosAction.onClick(() => {
    void openCommunityForActiveChat("kudos");
  });
  const stopChatCommentAction = chatCommentAction.onClick(() => {
    void openCommunityForActiveChat("comment");
  });

  const charactersLaunchButton = ctx.dom.createElement("button", {
    type: "button",
    class: "dcv1-native-launch",
    title: "Browse Datacat",
    "aria-label": "Browse Datacat",
  });
  charactersLaunchButton.innerHTML = CAT_ICON;
  const activateDatacat = () => tab.activate();
  charactersLaunchButton.addEventListener("click", activateDatacat);

  let charactersLaunchRaf = 0;
  const hiddenScrollableTabButtons = new Set();
  const placeCharactersLaunchButton = () => {
    charactersLaunchRaf = 0;
    const sidebar = document.querySelector('[data-spindle-mount="sidebar"]');
    const fixedSlot = sidebar?.lastElementChild;
    const settingsButton = fixedSlot?.querySelector?.("button");
    if (fixedSlot instanceof HTMLElement && settingsButton) {
      if (charactersLaunchButton.parentElement !== fixedSlot) {
        fixedSlot.insertBefore(charactersLaunchButton, settingsButton);
      }
      for (const button of sidebar.querySelectorAll('button[title="Datacat"]')) {
        if (button === charactersLaunchButton) continue;
        button.classList.add("dcv1-native-scroll-tab");
        hiddenScrollableTabButtons.add(button);
      }
    }
    const active = tab.root.isConnected;
    charactersLaunchButton.dataset.active = String(active);
    charactersLaunchButton.setAttribute("aria-pressed", String(active));
    if (active) {
      attempts = 0;
      markHost();
    } else {
      clearDatacatHostFrame();
    }
  };
  const scheduleCharactersLaunchButton = () => {
    if (charactersLaunchRaf) return;
    charactersLaunchRaf = requestAnimationFrame(
      placeCharactersLaunchButton,
    );
  };
  const characterToolbarRoot =
    document.querySelector("[data-app-root]") || document.body;
  const characterToolbarObserver = new MutationObserver(
    scheduleCharactersLaunchButton,
  );
  characterToolbarObserver.observe(characterToolbarRoot, {
    childList: true,
    subtree: true,
  });
  const handlePageHide = () => persistBrowserStateNow();
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("hashchange", scheduleCharactersLaunchButton);
  scheduleCharactersLaunchButton();

  window.addEventListener("focus", syncAccountAfterFocus);
  document.addEventListener(
    "pointerdown",
    closeMenuAfterOutsidePointer,
    true,
  );

  render();
  syncTagPanelVisibility();
  catalogObserver.observe(catalogSentinel);
  raf = requestAnimationFrame(markHost);
  void (async () => {
    try {
      localStorage.removeItem(storageKey("installation_id"));
      localStorage.removeItem(storageKey("access_token"));
      sessionStorage.removeItem(storageKey("verification_lease"));
    } catch (_) {}
    try {
      const transportAllowed = await ensureSecureTransportPermission();
      if (!transportAllowed) {
        throw new Error("Lumiverse did not grant secure Datacat network access.");
      }
      const secureState = await datacatBackendRequest("state");
      applySecureState(secureState);
    } catch (error) {
      const message = publicErrorMessage(
        error,
        "Secure Datacat access is unavailable.",
      );
      state.initializing = false;
      if (state.viewMode === "fresh") state.freshError = message;
      else if (state.viewMode === "imports") state.savedError = message;
      else state.error = message;
      setStatus(message, true);
      render();
      return;
    }
    await refreshCatalog();
    state.initializing = false;
    render();
    if (pendingCreatorRef) await openCreator(pendingCreatorRef);
    restorePersistedScroll();
  })();

  return () => {
    window.clearTimeout(searchTimer);
    window.clearTimeout(tagSearchTimer);
    window.clearTimeout(linkPollTimer);
    window.clearTimeout(verificationPollTimer);
    window.clearTimeout(browserStateSaveTimer);
    persistBrowserStateNow();
    catalogObserver.disconnect();
    tagObserver.disconnect();
    creatorObserver.disconnect();
    characterToolbarObserver.disconnect();
    cancelAnimationFrame(raf);
    cancelAnimationFrame(charactersLaunchRaf);
    stopActivationWatch();
    stopChatKudosAction();
    stopChatCommentAction();
    chatKudosAction.destroy();
    chatCommentAction.destroy();
    charactersLaunchButton.removeEventListener(
      "click",
      activateDatacat,
    );
    charactersLaunchButton.remove();
    for (const button of hiddenScrollableTabButtons) {
      button.classList.remove("dcv1-native-scroll-tab");
    }
    hiddenScrollableTabButtons.clear();
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener(
      "hashchange",
      scheduleCharactersLaunchButton,
    );
    window.removeEventListener("focus", syncAccountAfterFocus);
    stopBackendMessages();
    datacatBackendRequest = null;
    for (const pending of pendingLinkIndexRequests.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(
        new Error("The Datacat browser was closed."),
      );
    }
    pendingLinkIndexRequests.clear();
    document.removeEventListener(
      "pointerdown",
      closeMenuAfterOutsidePointer,
      true,
    );
    root.removeEventListener("click", handleSurfaceClick);
    modalHost.removeEventListener("click", handleSurfaceClick);
    root.removeEventListener("keydown", handleSurfaceKeydown);
    modalHost.removeEventListener("keydown", handleSurfaceKeydown);
    root.removeEventListener("click", scheduleBrowserStateSave);
    modalHost.removeEventListener("click", scheduleBrowserStateSave);
    root.removeEventListener("keydown", scheduleBrowserStateSave);
    modalHost.removeEventListener("keydown", scheduleBrowserStateSave);
    catalogScroll.removeEventListener("scroll", scheduleBrowserStateSave);
    closeLocalCharacterModal();
    document.body.classList.remove("dcv1-character-modal-open");
    modalHost.remove();
    clearDatacatHostFrame();
    tab.root.classList.remove("dcv1-drawer-root");
    tab.destroy();
    removeStyle();
  };
}
