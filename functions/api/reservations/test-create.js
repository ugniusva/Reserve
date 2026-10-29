import { adminAuthenticated } from "../admin/_auth.js";
import { createReservation } from "./create.js";

export async function onRequestPost(context) {
  if (!(await adminAuthenticated(context.request, context.env))) {
    return new Response(JSON.stringify({ ok: false, error: "Admin sign-in is required for 1 GEL test bookings." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return createReservation(context, { testBooking: true });
}
