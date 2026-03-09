function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function onRequestPost() {
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": "admin_auth=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0",
    }
  );
}