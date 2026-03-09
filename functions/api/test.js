export async function onRequest(context) {
  const { DB } = context.env;

  const result = await DB.prepare(
    "SELECT datetime('now') as now"
  ).first();

  return Response.json(result);
}