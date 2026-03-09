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

    return json(
      { ok: true },
      200,
      {
        "Set-Cookie": `admin_auth=ok; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=86400`,
      }
    );
  } catch (error) {
    return json({ ok: false, error: "Login failed." }, 500);
  }
}