const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

async function loadToken() {
  const listRes = await fetch("https://blob.vercel-storage.com?prefix=ml_token.json&limit=1", {
    headers: { "Authorization": `Bearer ${BLOB_TOKEN}` },
  });
  const list = await listRes.json();
  if (!list.blobs || list.blobs.length === 0) throw new Error("No token saved. Please authenticate first.");
  const res = await fetch(list.blobs[0].url);
  if (!res.ok) throw new Error("Failed to load token");
  return res.json();
}

async function saveToken(payload) {
  await fetch("https://blob.vercel-storage.com/ml_token.json", {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${BLOB_TOKEN}`,
      "Content-Type": "application/json",
      "x-allow-overwrite": "1",
    },
    body: JSON.stringify(payload),
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

async function fetchAllPausedItems(token, sellerId) {
  const items = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const res = await fetch(
      `https://api.mercadolibre.com/users/${sellerId}/items/search?status=paused&offset=${offset}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!data.results || data.results.length === 0) break;
    items.push(...data.results);
    if (offset + limit >= data.paging.total) break;
    offset += limit;
  }
  return items;
}

async function fetchItemsDetail(token, itemIds) {
  const allItems = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    const chunk = itemIds.slice(i, i + 20).join(",");
    const res = await fetch(
      `https://api.mercadolibre.com/items?ids=${chunk}&attributes=id,title,status,sub_status,attributes,seller_sku,permalink,thumbnail,price`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    allItems.push(...data.map((d) => d.body).filter(Boolean));
  }
  return allItems;
}

function extractSku(item) {
  if (item.seller_sku) return item.seller_sku;
  if (item.attributes) {
    const skuAttr = item.attributes.find(
      (a) => a.id === "SELLER_SKU" || a.id === "MODEL" || a.id === "PART_NUMBER"
    );
    if (skuAttr) return skuAttr.value_name;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token, userId } = await getValidToken();
    const pausedItemIds = await fetchAllPausedItems(token, userId);
    if (pausedItemIds.length === 0) return res.json({ items: [], total: 0, seller_id: userId });

    const itemsDetail = await fetchItemsDetail(token, pausedItemIds);
    const moderatedItems = itemsDetail
      .filter((item) => item.sub_status && item.sub_status.length > 0)
      .map((item) => ({
        id: item.id,
        title: item.title,
        sku: extractSku(item),
        status: item.status,
        sub_status: item.sub_status,
        price: item.price,
        thumbnail: item.thumbnail,
        permalink: item.permalink,
        appeal_url: `https://www.mercadolibre.com.mx/reclamaciones/reclamo/enviar?resource_type=item&resource_id=${item.id}`,
      }));

    return res.json({ items: moderatedItems, total: moderatedItems.length, seller_id: userId, paused_total: pausedItemIds.length });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
