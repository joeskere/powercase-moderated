import { get } from "@vercel/blob";

async function getValidToken() {
  const blob = await get("ml_token.json");
  if (!blob) throw new Error("No token saved. Please authenticate first.");

  const tokenData = JSON.parse(await (await fetch(blob.url)).text());

  // Auto-refresh si está por vencer (menos de 1 hora)
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
      const newPayload = {
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        user_id: newToken.user_id,
        expires_at: Date.now() + newToken.expires_in * 1000,
        saved_at: new Date().toISOString(),
      };
      const { put } = await import("@vercel/blob");
      await put("ml_token.json", JSON.stringify(newPayload), { access: "public", allowOverwrite: true });
      return newToken.access_token;
    }
  }

  return tokenData.access_token;
}

// Trae todos los items del seller en estado pausado/moderado
async function fetchAllPausedItems(token, sellerId) {
  const items = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const url = `https://api.mercadolibre.com/users/${sellerId}/items/search?status=paused&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!data.results || data.results.length === 0) break;

    items.push(...data.results);

    if (offset + limit >= data.paging.total) break;
    offset += limit;
  }

  return items;
}

// Trae detalle de items en lotes de 20
async function fetchItemsDetail(token, itemIds) {
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    chunks.push(itemIds.slice(i, i + 20));
  }

  const allItems = [];
  for (const chunk of chunks) {
    const ids = chunk.join(",");
    const res = await fetch(
      `https://api.mercadolibre.com/items?ids=${ids}&attributes=id,title,status,sub_status,attributes,seller_sku,permalink,thumbnail,price,available_quantity`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    allItems.push(...data.map((d) => d.body).filter(Boolean));
  }

  return allItems;
}

// Extrae el SELLER_SKU de los atributos del item
function extractSku(item) {
  // 1. Campo directo seller_sku
  if (item.seller_sku) return item.seller_sku;

  // 2. En atributos del item
  if (item.attributes) {
    const skuAttr = item.attributes.find(
      (a) => a.id === "SELLER_SKU" || a.id === "MODEL" || a.id === "PART_NUMBER"
    );
    if (skuAttr) return skuAttr.value_name;
  }

  return null;
}

// Verifica si el item está moderado por propiedad intelectual
function isIntellectualPropertyViolation(item) {
  if (!item.sub_status) return false;
  return item.sub_status.some(
    (s) =>
      s === "under_review" ||
      s === "not_yet_active" ||
      s === "deleted" ||
      s === "suspended_by_ml_com"
  );
}

// Trae las restricciones del item para verificar el motivo real
async function fetchItemRestrictions(token, itemId) {
  try {
    const res = await fetch(`https://api.mercadolibre.com/items/${itemId}/restrictions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = await getValidToken();

    // Obtener seller ID del token guardado
    const blob = await get("ml_token.json");
    const tokenData = JSON.parse(await (await fetch(blob.url)).text());
    const sellerId = tokenData.user_id;

    // 1. Traer todos los items pausados
    console.log(`Fetching paused items for seller ${sellerId}...`);
    const pausedItemIds = await fetchAllPausedItems(token, sellerId);
    console.log(`Found ${pausedItemIds.length} paused items`);

    if (pausedItemIds.length === 0) {
      return res.json({ items: [], total: 0, seller_id: sellerId });
    }

    // 2. Traer detalle de todos los items
    const itemsDetail = await fetchItemsDetail(token, pausedItemIds);

    // 3. Filtrar los que tienen sub_status relacionado a moderación
    // La API de ML México usa sub_status para indicar el motivo
    // "suspended_by_brand" o similar indica propiedad intelectual
    const moderatedItems = [];

    for (const item of itemsDetail) {
      // Buscar items con cualquier sub_status de suspensión
      const subStatuses = item.sub_status || [];
      const isSuspended = subStatuses.length > 0;

      if (isSuspended) {
        const sku = extractSku(item);

        moderatedItems.push({
          id: item.id,
          title: item.title,
          sku: sku,
          status: item.status,
          sub_status: item.sub_status,
          price: item.price,
          available_quantity: item.available_quantity,
          thumbnail: item.thumbnail,
          permalink: item.permalink,
          appeal_url: `https://www.mercadolibre.com.mx/reclamaciones/reclamo/enviar?resource_type=item&resource_id=${item.id}`,
        });
      }
    }

    console.log(`Found ${moderatedItems.length} moderated items`);

    return res.json({
      items: moderatedItems,
      total: moderatedItems.length,
      seller_id: sellerId,
      paused_total: pausedItemIds.length,
    });
  } catch (err) {
    console.error("Error fetching moderated items:", err);
    return res.status(500).json({ error: err.message });
  }
}
