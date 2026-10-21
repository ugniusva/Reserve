const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function adminAuthenticated(request) {
  return (request.headers.get("Cookie") || "").includes("admin_auth=ok");
}

export function columnName(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Invalid reservation column.");
  return `"${name}"`;
}

export function snapshotGuard(row) {
  // Ignore only the audit timestamp so consecutive undos can restore earlier actions.
  const keys = Object.keys(row).filter(key => key !== "updated_at");
  return { sql: keys.map(key => `${columnName(key)} IS ?`).join(" AND "), values: keys.map(key => row[key]) };
}

function validateSnapshots(before, after) {
  if (!before && !after) throw new Error("Invalid undo record.");
  for (const row of [before, after].filter(Boolean)) {
    if (typeof row !== "object" || Array.isArray(row) || !row.id) throw new Error("Invalid undo record.");
    for (const [key,value] of Object.entries(row)) {
      columnName(key);
      if (value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw new Error("Unsupported reservation value.");
    }
  }
  if (before && after && before.id !== after.id) throw new Error("Invalid undo record.");
}

async function undoKey(env) {
  if (!env.ADMIN_PASSWORD) throw new Error("Admin password is not configured.");
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(`reserve-admin-undo-v1\0${env.ADMIN_PASSWORD}`));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function createUndoToken(env, before, after) {
  validateSnapshots(before, after);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = encoder.encode(JSON.stringify({ version: 1, expires: Date.now() + 86400000, before, after }));
  if (payload.length > 500000) throw new Error("This reservation is too large for undo. No changes were made.");
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await undoKey(env), payload));
  const bytes = new Uint8Array(iv.length + encrypted.length);
  bytes.set(iv); bytes.set(encrypted, iv.length);
  // Chunk conversion avoids argument/stack limits for larger callback payloads.
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export async function readUndoToken(env, token) {
  if (typeof token !== "string" || token.length > 700000) throw new Error("Invalid undo record.");
  const bytes = Uint8Array.from(atob(token), char => char.charCodeAt(0));
  const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0,12) }, await undoKey(env), bytes.subarray(12));
  const payload = JSON.parse(decoder.decode(decoded));
  if (payload.version !== 1 || !Number.isFinite(payload.expires) || payload.expires < Date.now()) throw new Error("This undo record has expired.");
  validateSnapshots(payload.before, payload.after);
  return payload;
}
