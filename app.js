const BACKEND = 'https://powercase-moderated.vercel.app';
let allItems = [];
let stockMap = {};
let currentFilter = 'all';
let searchQuery = '';

window.addEventListener('load', () => {
  checkURLParams();
  checkAuthStatus();
});

function checkURLParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === 'true') {
    const userId = params.get('user_id');
    showToast(`✓ Cuenta conectada correctamente (ID: ${userId})`, 'success');
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (params.get('error')) {
    const errMap = {
      oauth_denied: 'Autenticación cancelada.',
      token_exchange_failed: 'Error al obtener el token. Intentá de nuevo.',
    };
    showToast(errMap[params.get('error')] || 'Error desconocido.', 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

async function checkAuthStatus() {
  const pill = document.getElementById('status-pill');
  const dot = pill.querySelector('.status-dot');
  const text = document.getElementById('status-text');

  try {
    const res = await fetch(`${BACKEND}/api/auth/status`);
    const data = await res.json();

    if (data.connected) {
      pill.className = 'connected';
      dot.classList.add('pulse');
      text.textContent = `ML conectado · ID ${data.user_id}`;
      showAuthDone(data.user_id);
      updateFetchButton();
    } else if (data.expired) {
      pill.className = 'disconnected';
      text.textContent = 'Token vencido — reconectá';
      showToast('Tu sesión venció. Volvé a conectar la cuenta.', 'error');
    } else {
      pill.className = 'disconnected';
      text.textContent = 'Sin conexión ML';
    }
  } catch {
    pill.className = 'disconnected';
    text.textContent = 'Sin conexión ML';
  }
}

function showAuthDone(userId) {
  document.getElementById('auth-content').style.display = 'none';
  document.getElementById('auth-done').style.display = 'block';
  document.getElementById('auth-seller-id').textContent = `USER ID: ${userId}`;
  document.getElementById('step-auth').classList.add('done');
}

function disconnectAccount() {
  document.getElementById('auth-content').style.display = 'block';
  document.getElementById('auth-done').style.display = 'none';
  document.getElementById('step-auth').classList.remove('done');
  document.getElementById('status-pill').className = 'disconnected';
  document.getElementById('status-text').textContent = 'Sin conexión ML';
  updateFetchButton();
}

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('drag-over');
}

function handleDragLeave() {
  document.getElementById('drop-zone').classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processExcelFile(file);
}

function handleFile(e) {
  const file = e.target.files[0];
  if (file) processExcelFile(file);
}

function processExcelFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rows.length) {
        showToast('El Excel está vacío.', 'error');
        return;
      }

      const headers = Object.keys(rows[0]);
      const skuCol = headers.find(h =>
        h.toLowerCase().includes('codigo sistema') ||
        h.toLowerCase().includes('código sistema') ||
        h.toLowerCase() === 'sku' ||
        h.toLowerCase().includes('codigo_sistema')
      );
      const stockCol = headers.find(h =>
        h.toLowerCase().includes('stock') ||
        h.toLowerCase().includes('cantidad') ||
        h.toLowerCase().includes('disponible')
      );

      if (!skuCol) {
        showToast(`No se encontró columna "Codigo Sistema". Columnas: ${headers.slice(0,5).join(', ')}`, 'error');
        return;
      }

      stockMap = {};
      let skuCount = 0;

      rows.forEach(row => {
        const sku = String(row[skuCol] || '').trim();
        if (!sku) return;
        const qty = stockCol ? parseFloat(row[stockCol]) || 0 : 1;
        if (qty > 0) {
          stockMap[sku] = qty;
          skuCount++;
        }
      });

      document.getElementById('file-name').textContent = `✓ ${file.name}`;
      document.getElementById('excel-stats').style.display = 'block';
      document.getElementById('excel-stats').textContent =
        `${rows.length} filas · ${skuCount} SKUs con stock · col: "${skuCol}"${stockCol ? ` / "${stockCol}"` : ''}`;
      document.getElementById('step-excel').classList.add('done');

      updateFetchButton();
      showToast(`Excel cargado: ${skuCount} SKUs con stock`, 'success');

      if (allItems.length) renderTable();
    } catch (err) {
      showToast('Error al leer el Excel: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function updateFetchButton() {
  const authDone = document.getElementById('auth-done').style.display !== 'none';
  document.getElementById('btn-fetch').disabled = !authDone;
}

async function fetchModerated() {
  document.getElementById('btn-fetch').disabled = true;
  document.getElementById('loading').style.display = 'block';
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('stats-bar').style.display = 'none';
  document.getElementById('search-wrap').style.display = 'none';

  setLoadingText('Consultando publicaciones pausadas...');

  try {
    const res = await fetch(`${BACKEND}/api/moderated`);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    allItems = data.items || [];

    document.getElementById('loading').style.display = 'none';
    document.getElementById('btn-fetch').disabled = false;

    if (!allItems.length) {
      document.getElementById('empty-state').style.display = 'block';
      showToast('No hay publicaciones moderadas.', 'info');
      return;
    }

    updateStats();
    renderTable();

    document.getElementById('stats-bar').style.display = 'flex';
    document.getElementById('results-section').style.display = 'block';
    document.getElementById('search-wrap').style.display = 'flex';

    showToast(`${allItems.length} publicaciones moderadas encontradas`, 'success');
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('btn-fetch').disabled = false;
    showToast('Error: ' + err.message, 'error');
  }
}

function setLoadingText(txt) {
  document.getElementById('loading-text').textContent = txt;
}

function updateStats() {
  let withStock = 0, noStock = 0, noSku = 0;
  allItems.forEach(item => {
    if (!item.sku) noSku++;
    else if (stockMap[item.sku] > 0) withStock++;
    else noStock++;
  });
  document.getElementById('stat-total').textContent = allItems.length;
  document.getElementById('stat-stock').textContent = withStock;
  document.getElementById('stat-nostock').textContent = noStock;
  document.getElementById('stat-nosku').textContent = noSku;
}

function setFilter(filter, el) {
  currentFilter = filter;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderTable();
}

function filterTable() {
  searchQuery = document.getElementById('search-input').value.toLowerCase();
  renderTable();
}

function getStockInfo(sku) {
  if (!sku) return { status: 'unknown', qty: null };
  if (Object.keys(stockMap).length === 0) return { status: 'unknown', qty: null };
  const qty = stockMap[sku];
  return qty > 0 ? { status: 'stock', qty } : { status: 'nostock', qty: 0 };
}

function getMotivo(item) {
  if (!item.sub_status || !item.sub_status.length) return 'Suspendido';
  const map = {
    under_review: 'En revisión',
    suspended_by_ml_com: 'Suspendido por ML',
    not_yet_active: 'No activo',
    deleted: 'Eliminado',
  };
  return item.sub_status.map(s => map[s] || s).join(', ');
}

function renderTable() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  const filtered = allItems.filter(item => {
    const stockInfo = getStockInfo(item.sku);
    if (currentFilter === 'stock' && stockInfo.status !== 'stock') return false;
    if (currentFilter === 'nostock' && stockInfo.status !== 'nostock') return false;
    if (currentFilter === 'nosku' && item.sku) return false;
    if (searchQuery) {
      const haystack = `${item.title} ${item.sku || ''} ${item.id}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr class="no-results-row"><td colspan="6">No hay resultados para este filtro.</td></tr>`;
    return;
  }

  filtered.forEach(item => {
    const stockInfo = getStockInfo(item.sku);
    const skuDisplay = item.sku
      ? `<span class="sku-tag ${stockInfo.status === 'stock' ? 'matched' : ''}">${item.sku}</span>`
      : `<span class="sku-tag no-sku">Sin SKU</span>`;

    let stockBadge;
    if (stockInfo.status === 'stock') {
      stockBadge = `<span class="stock-badge has-stock">● ${stockInfo.qty} uds</span>`;
    } else if (stockInfo.status === 'nostock') {
      stockBadge = `<span class="stock-badge no-stock">✗ Sin stock</span>`;
    } else {
      stockBadge = `<span class="stock-badge unknown">— Sin cruzar</span>`;
    }

    const price = item.price
      ? `<span class="price-cell">$${Number(item.price).toLocaleString('es-MX')}</span>`
      : `<span style="color:var(--text-dim)">—</span>`;

    const thumb = item.thumbnail
      ? `<img src="${item.thumbnail}" class="item-thumb" alt="" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="item-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)">📦</div>`;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div class="item-title-cell">
          ${thumb}
          <div>
            <div class="item-title">${item.title}</div>
            <div class="item-id">${item.id}</div>
          </div>
        </div>
      </td>
      <td>${skuDisplay}</td>
      <td>${stockBadge}</td>
      <td>${price}</td>
      <td style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">${getMotivo(item)}</td>
      <td>
        <a href="${item.appeal_url}" target="_blank" rel="noopener" class="btn btn-appeal">
          Apelar →
        </a>
      </td>
    `;
    tbody.appendChild(row);
  });
}

let toastTimer;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = type; }, 4000);
}
