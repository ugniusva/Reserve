import { ADMIN_SESSION_SECONDS, createAdminSession } from "./_auth.js";

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

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const password = String(body.password || "");

    if (!context.env.ADMIN_PASSWORD) {
      return json({ ok: false, error: "Admin password is not configured." }, 500);
    }

    if (password !== context.env.ADMIN_PASSWORD) {
      return json({ ok: false, error: "Incorrect password." }, 401);
    }

    const session = await createAdminSession(context.env);
    return json(
      { ok: true },
      200,
      {
        "Set-Cookie": `admin_auth=${session}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${ADMIN_SESSION_SECONDS}`,
      }
    );
  } catch (error) {
    return json({ ok: false, error: "Login failed." }, 500);
  }
}
