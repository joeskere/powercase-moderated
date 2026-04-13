import { put, get } from "@vercel/blob";

const ML_APP_ID = process.env.ML_APP_ID;
const ML_SECRET = process.env.ML_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || "https://powercase-moderated.vercel.app/api/auth/callback";

export default async function handler(req, res) {
  const { pathname } = new URL(req.url, `https://${req.headers.host}`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET /api/auth/login → redirige a ML OAuth
  if (pathname === "/api/auth/login") {
    const mlAuthUrl = `https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${ML_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    return res.redirect(mlAuthUrl);
  }

  // GET /api/auth/callback → recibe code, obtiene token, guarda en Blob
  if (pathname === "/api/auth/callback") {
    const { code, error } = req.query;

    if (error || !code) {
      return res.redirect(`/?error=oauth_denied`);
    }

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
      if (tokenData.error) throw new Error(tokenData.error);

      // Guardar token en Blob
      const tokenPayload = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        user_id: tokenData.user_id,
        expires_at: Date.now() + tokenData.expires_in * 1000,
        saved_at: new Date().toISOString(),
      };

      await put("ml_token.json", JSON.stringify(tokenPayload), {
        access: "public",
        allowOverwrite: true,
      });

      return res.redirect(`/?connected=true&user_id=${tokenData.user_id}`);
    } catch (err) {
      console.error("OAuth error:", err);
      return res.redirect(`/?error=token_exchange_failed`);
    }
  }

  // GET /api/auth/status → devuelve si hay token activo
  if (pathname === "/api/auth/status") {
    try {
      const blob = await get("ml_token.json");
      if (!blob) return res.json({ connected: false });

      const tokenData = JSON.parse(await (await fetch(blob.url)).text());
      const isExpired = Date.now() > tokenData.expires_at;

      return res.json({
        connected: !isExpired,
        expired: isExpired,
        user_id: tokenData.user_id,
        saved_at: tokenData.saved_at,
      });
    } catch {
      return res.json({ connected: false });
    }
  }

  // GET /api/auth/refresh → refresca el token
  if (pathname === "/api/auth/refresh") {
    try {
      const blob = await get("ml_token.json");
      if (!blob) return res.status(401).json({ error: "No token saved" });

      const tokenData = JSON.parse(await (await fetch(blob.url)).text());

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

      const newPayload = {
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        user_id: newToken.user_id,
        expires_at: Date.now() + newToken.expires_in * 1000,
        saved_at: new Date().toISOString(),
      };

      await put("ml_token.json", JSON.stringify(newPayload), {
        access: "public",
        allowOverwrite: true,
      });

      return res.json({ success: true, user_id: newToken.user_id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: "Not found" });
}
