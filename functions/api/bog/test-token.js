export async function onRequestGet(context) {
  try {
    const tokenData = await getBogAccessToken(context.env);

    return new Response(
      JSON.stringify({
        ok: true,
        has_access_token: !!tokenData.access_token,
        expires_in: tokenData.expires_in ?? null,
        token_type: tokenData.token_type ?? null,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(err?.message || err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}

async function getBogAccessToken(env) {
  const tokenUrl = "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token";

  const credentials = `${env.BOG_CLIENT_ID}:${env.BOG_CLIENT_SECRET}`;
  const basic = btoa(credentials);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: "grant_type=client_credentials",
  });

  const text = await response.text();

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`BOG token endpoint returned non-JSON: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`BOG token request failed: ${response.status} ${JSON.stringify(data)}`);
  }

  if (!data.access_token) {
    throw new Error(`BOG token response missing access_token: ${JSON.stringify(data)}`);
  }

  return data;
}