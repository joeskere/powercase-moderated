import { put, list, getDownloadUrl } from "@vercel/blob";

const ML_APP_ID = process.env.ML_APP_ID;
const ML_SECRET = process.env.ML_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || "https://powercase-moderated.vercel.app/api/auth/callback";
const BLOB_TOKEN = process.env.blobbyy_READ_WRITE_TOKEN;

async function saveToken(payload) {
  await put("ml_token.json", JSON.stringify(payload), {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    token: BLOB_TOKEN,
  });
}

async function loadToken() {
  try {
    const { blobs } = await list({ prefix: "ml_token.json", token: BLOB_TOKEN });
    if (!blobs.length) return null;
    const res = await fetch(blobs[0].url);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (pathname === "/api/auth/login") {
    const mlAuthUrl = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${ML_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    return res.redirect(mlAuthUrl);
  }

  if (pathname === "/api/auth/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (error || !code) return res.redirect(`/?error=oauth_denied`);
    try {
      const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: ML_APP_ID,
          client_secret: ML_SECRET,
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.message || tokenData.error);
      await saveToken({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        user_id: tokenData.user_id,
        expires_at: Date.now() + tokenData.expires_in * 1000,
        saved_at: new Date().toISOString(),
      });
      return res.redirect(`/?connected=true&user_id=${tokenData.user_id}`);
    } catch (err) {
      console.error("OAuth error:", err);
      return res.redirect(`/?error=token_exchange_failed&msg=${encodeURIComponent(err.message)}`);
    }
  }

  if (pathname === "/api/auth/status") {
    try {
      const tokenData = await loadToken();
      if (!tokenData) return res.json({ connected: false });
      const isExpired = Date.now() > tokenData.expires_at;
      return res.json({ connected: !isExpired, expired: isExpired, user_id: tokenData.user_id, saved_at: tokenData.saved_at });
    } catch {
      return res.json({ connected: false });
    }
  }

  if (pathname === "/api/auth/refresh") {
    try {
      const tokenData = await loadToken();
      if (!tokenData) return res.status(401).json({ error: "No token saved" });
      const refreshRes = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: ML_APP_ID,
          client_secret: ML_SECRET,
          refresh_token: tokenData.refresh_token,
        }),
      });
      const newToken = await refreshRes.json();
      if (newToken.error) throw new Error(newToken.error);
      await saveToken({
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        user_id: newToken.user_id,
        expires_at: Date.now() + newToken.expires_in * 1000,
        saved_at: new Date().toISOString(),
      });
      return res.json({ success: true, user_id: newToken.user_id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: "Not found" });
}
