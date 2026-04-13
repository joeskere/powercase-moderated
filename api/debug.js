import { list } from "@vercel/blob";

const BLOB_TOKEN = process.env.blobbyy_READ_WRITE_TOKEN;

async function loadToken() {
  const { blobs } = await list({ prefix: "ml_token.json", token: BLOB_TOKEN });
  if (!blobs.length) throw new Error("No token");
  const res = await fetch(blobs[0].url);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const tokenData = await loadToken();
    const sellerId = tokenData.user_id;

    // Probar distintos status
    const statuses = ["under_review", "paused", "inactive"];
    const results = {};

    for (const status of statuses) {
      const r = await fetch(
        `https://api.mercadolibre.com/users/${sellerId}/items/search?status=${status}&limit=1`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      const data = await r.json();
      results[status] = data.paging?.total ?? data;
    }

    return res.json({ seller_id: sellerId, totals: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
