export const ADMIN_SESSION_SECONDS = 14 * 24 * 60 * 60;

const encoder = new TextEncoder();
const sessionContext = "reserve-admin-session-v1\0";

async function sessionKey(env) {
  if (!env.ADMIN_PASSWORD) throw new Error("Admin password is not configured.");
  return crypto.subtle.importKey(
    "raw", encoder.encode(env.ADMIN_PASSWORD),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAdminSession(env) {
  const expires = Date.now() + ADMIN_SESSION_SECONDS * 1000;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${expires}.${nonce}`;
  const signature = await crypto.subtle.sign(
    "HMAC", await sessionKey(env), encoder.encode(sessionContext + payload)
  );
  return `${payload}.${hex(new Uint8Array(signature))}`;
}

export async function adminAuthenticated(request, env) {
  try {
    if (!env.ADMIN_PASSWORD) return false;
    const cookies = (request.headers.get("Cookie") || "").split(";")
      .map(cookie => cookie.trim())
      .filter(cookie => cookie.split("=", 1)[0] === "admin_auth");
    // Ambiguous duplicate cookies and the old fixed value are never sessions.
    if (cookies.length !== 1) return false;
    const token = cookies[0].slice("admin_auth=".length);
    const match = /^v1\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
    if (!match) return false;
    const now = Date.now();
    const expires = Number(match[1]);
    if (expires <= now || expires > now + ADMIN_SESSION_SECONDS * 1000) return false;
    const payload = `v1.${match[1]}.${match[2]}`;
    const signature = Uint8Array.from(match[3].match(/../g), byte => parseInt(byte, 16));
    return await crypto.subtle.verify(
      "HMAC", await sessionKey(env), signature, encoder.encode(sessionContext + payload)
    );
  } catch {
    return false;
  }
}
