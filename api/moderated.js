import { put, list } from "@vercel/blob";

const BLOB_TOKEN = process.env.blobbyy_READ_WRITE_TOKEN;

async function loadToken() {
  const { blobs } = await list({ prefix: "ml_token.json", token: BLOB_TOKEN });
  if (!blobs.length) throw new Error("No token saved. Please authenticate first.");
  const res = await fetch(blobs[0].url);
  if (!res.ok) throw new Error("Failed to load token");
  return res.json();
}

async function saveToken(payload) {
  await put("ml_token.json", JSON.stringify(payload), {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    token: BLOB_TOKEN,
  });
}

async function getValidToken() {
  const tokenData = await loadToken();
  if (Date.now() > tokenData.expires_at - 3600000) {
    const refreshRes = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: process.env.ML_APP_ID,
        client_secret: process.env.ML_SECRET,
        refresh_token: tokenData.refresh_token,
      }),
    });
    const newToken = await refreshRes.json();
    if (!newToken.error) {
      await saveToken({
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        user_id: newToken.user_id,
        expires_at: Date.now() + newToken.expires_in * 1000,
        saved_at: new Date().toISOString(),
      });
      return { token: newToken.access_token, userId: newToken.user_id };
    }
  }
  return { token: tokenData.access_token, userId: tokenData.user_id };
}

async function fetchAllPausedIds(token, sellerId) {
  const items = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `https://api.mercadolibre.com/users/${sellerId}/items/search?status=paused&offset=${offset}&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!data.results || data.results.length === 0) break;
    items.push(...data.results);
    if (offset + 50 >= data.paging.total) break;
    offset += 50;
  }
  return items;
}

async function fetchChunk(token, ids) {
  const res = await fetch(
    `https://api.mercadolibre.com/items?ids=${ids.join(",")}&attributes=id,title,status,sub_status,attributes,seller_sku,permalink,thumbnail,price`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.map(d => d.body).filter(Boolean);
}

async function fetchItemsDetailParallel(token, itemIds) {
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    chunks.push(itemIds.slice(i, i + 20));
  }
  // Procesar en grupos de 10 chunks simultáneos
  const allItems = [];
  for (let i = 0; i < chunks.length; i += 10) {
    const batch = chunks.slice(i, i + 10);
    const results = await Promise.all(batch.map(chunk => fetchChunk(token, chunk)));
    results.forEach(r => allItems.push(...r));
  }
  return allItems;
}

function extractSku(item) {
  if (item.seller_sku) return item.seller_sku;
  if (item.attributes) {
    const skuAttr = item.attributes.find(a => a.id === "SELLER_SKU" || a.id === "MODEL" || a.id === "PART_NUMBER");
    if (skuAttr) return skuAttr.value_name;
  }
  return null;
}

function getMotivoLabel(subStatuses) {
  if (!subStatuses) return "Desconocido";
  if (subStatuses.includes("forbidden")) return "Incumplió política de propiedad intelectual";
  if (subStatuses.includes("pending_documentation")) return "Sube la factura para comprobar originalidad";
  return subStatuses.join(", ");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token, userId } = await getValidToken();

    const pausedIds = await fetchAllPausedIds(token, userId);
    if (!pausedIds.length) return res.json({ items: [], total: 0, seller_id: userId });

    const itemsDetail = await fetchItemsDetailParallel(token, pausedIds);

    const ipItems = itemsDetail
      .filter(item =>
        item.sub_status &&
        (item.sub_status.includes("forbidden") || item.sub_status.includes("pending_documentation"))
      )
      .map(item => ({
        id: item.id,
        title: item.title,
        sku: extractSku(item),
        status: item.status,
        sub_status: item.sub_status,
        motivo: getMotivoLabel(item.sub_status),
        price: item.price,
        thumbnail: item.thumbnail,
        permalink: item.permalink,
        appeal_url: `https://www.mercadolibre.com.mx/reclamaciones/reclamo/enviar?resource_type=item&resource_id=${item.id}`,
      }));

    return res.json({ items: ipItems, total: ipItems.length, seller_id: userId, paused_total: pausedIds.length });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
