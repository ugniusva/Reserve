export async function onRequestGet(context) {
  const { RESEND_API_KEY } = context.env;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Reserve <info@reservetbilisi.ge>",
      to: "ugnius.valainis@gmail.com",
      subject: "Test email",
      html: "<h1>it works :3</h1>",
    }),
  });

  const data = await res.text();

  return new Response(data);
}