function isAuthenticated(request) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.includes("admin_auth=ok");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  try {
    if (!isAuthenticated(context.request)) {
  return json({ ok: false, error: "Unauthorized" }, 401);
}
    const { DB } = context.env;
    const url = new URL(context.request.url);

    const date = url.searchParams.get("date");
    const status = url.searchParams.get("status");

    let query = `
      SELECT
        id,
        first_name,
        last_name,
        phone,
        booking_date,
        booking_time,
        guests,
        requests,
        deposit_amount,
        currency,
        status,
        table_number,
        created_at,
        updated_at,
        paid_at
      FROM reservations
    `;

    const conditions = [];
    const binds = [];

    if (date) {
      conditions.push("booking_date = ?");
      binds.push(date);
    }

    if (status) {
      conditions.push("status = ?");
      binds.push(status);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY booking_date ASC, booking_time ASC, created_at DESC";

    const stmt = DB.prepare(query).bind(...binds);
    const result = await stmt.all();

    return json({
      ok: true,
      reservations: result.results || [],
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Failed to load reservations.",
      details: String(error),
    }, 500);
  }
}