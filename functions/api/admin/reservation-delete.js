function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthenticated(request) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.includes("admin_auth=ok");
}

export async function onRequestPost(context) {
  try {
    if (!isAuthenticated(context.request)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const { DB } = context.env;
    const body = await context.request.json();
    const id = String(body.id || "").trim();

    if (!id) {
      return json({ ok: false, error: "Missing reservation ID." }, 400);
    }

    const result = await DB.prepare("DELETE FROM reservations WHERE id = ?")
      .bind(id)
      .run();

    return json({ ok: true, result });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to delete reservation.",
      details: String(error),
    }, 500);
  }
}