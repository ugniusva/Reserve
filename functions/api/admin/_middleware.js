export async function onRequest(context) {
  const cookie = context.request.headers.get("Cookie") || "";
  const url = new URL(context.request.url);

  if (url.pathname === "/admin/login.html") {
    return context.next();
  }

  if (!cookie.includes("admin_auth=ok")) {
    return Response.redirect(new URL("/admin/login.html", context.request.url), 302);
  }

  return context.next();
}