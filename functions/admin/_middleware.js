import { adminAuthenticated } from "../api/admin/_auth.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  const publicAdminPaths = [
    "/admin/login",
    "/admin/login/",
    "/admin/login.html",
  ];

  if (publicAdminPaths.includes(path)) {
    return context.next();
  }

  if (!(await adminAuthenticated(context.request, context.env))) {
    return Response.redirect(new URL("/admin/login.html", context.request.url), 302);
  }

  return context.next();
}
