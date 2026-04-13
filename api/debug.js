import { list, getDownloadUrl } from "@vercel/blob";

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
    const ids = req.query.ids || "MLM3763796664,MLM2204674063";
    const r = await fetch(`https://api.mercadolibre.com/items?ids=${ids}&attributes=id,status,sub_status`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const data = await r.json();
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
