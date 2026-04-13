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
    const token = tokenData.access_token;

    // Probar filtro por sub_status directo
    const r1 = await fetch(
      `https://api.mercadolibre.com/users/${sellerId}/items/search?status=paused&sub_status=forbidden&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const d1 = await r1.json();

    const r2 = await fetch(
      `https://api.mercadolibre.com/users/${sellerId}/items/search?status=paused&sub_status=pending_documentation&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const d2 = await r2.json();

    return res.json({
      forbidden: { total: d1.paging?.total, sample: d1.results?.slice(0,3) },
      pending_documentation: { total: d2.paging?.total, sample: d2.results?.slice(0,3) },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
