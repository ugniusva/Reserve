export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const cookie = context.request.headers.get("Cookie") || "";

  const publicAdminPaths = [
    "/admin/login",
    "/admin/login/",
    "/admin/login.html",
  ];

  if (publicAdminPaths.includes(path)) {
    return context.next();
  }

  if (!cookie.includes("admin_auth=ok")) {
    return Response.redirect(new URL("/admin/login.html", context.request.url), 302);
  }

  return context.next();
}