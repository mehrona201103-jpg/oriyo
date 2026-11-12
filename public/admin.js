const $ = (s) => document.querySelector(s);
const fmt = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
const STATUS_LABELS = {
  new: 'Новый', pending_payment: 'Ждёт оплаты', paid: 'Оплачен', shipped: 'Отправлен',
  delivered: 'Доставлен', cancelled: 'Отменён',
};

// Запрос к API: cookie сессии передаётся автоматически
async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) {
    location.replace('/login?next=/admin');
    throw new Error('Нужен вход администратора');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Ошибка сервера');
  return body;
}

function toastMsg(el, text, ok = false) {
  el.textContent = text;
  el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
}

// ---------- Выход ----------
$('#logout').onclick = async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  location.href = '/login';
};

// ---------- Вкладки ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    const loaders = { stats: loadStats, products: loadProducts, orders: loadOrders };
    loaders[btn.dataset.tab]();
  };
});

// ---------- Статистика ----------
async function loadStats() {
  const s = await api('/api/admin/stats');

  const cards = [
    ['Выручка', fmt(s.revenue)],
    ['Заказов всего', s.orders],
    ['За 24 часа', s.orders_24h],
    ['Средний чек', fmt(s.avg_check)],
    ['Покупателей', s.customers],
    ['Активных товаров', s.products.active],
    ['Заканчивается (≤3)', s.products.low_stock],
  ];
  $('#statCards').innerHTML = cards
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');

  // График выручки за 14 дней
  const max = Math.max(1, ...s.daily.map((d) => d.revenue));
  const chart = $('#chart');
  chart.innerHTML = s.daily.length
    ? s.daily
        .map(
          (d) => `
          <div class="bar-wrap" title="${d.day}: ${fmt(d.revenue)}, заказов: ${d.orders}">
            <div class="bar" style="height:${(d.revenue / max) * 100}%"></div>
            <div class="bar-label">${d.day.slice(5)}</div>
          </div>`
        )
        .join('')
    : '<p style="color:var(--muted)">Пока нет продаж</p>';

  $('#topBody').innerHTML = s.top.length
    ? s.top.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.qty}</td><td>${fmt(t.revenue)}</td></tr>`).join('')
    : '<tr><td colspan="3" style="color:var(--muted)">Нет данных</td></tr>';
}

// ---------- Товары ----------
let productsCache = [];

async function loadProducts() {
  productsCache = await api('/api/admin/products');
  $('#productsBody').innerHTML = productsCache.length
    ? productsCache
        .map(
          (p) => `
          <tr style="${p.active ? '' : 'opacity:.45'}">
            <td>${esc(p.name)}</td>
            <td>${esc(p.category)}</td>
            <td>${fmt(p.price)}</td>
            <td>${p.stock}</td>
            <td>${p.active ? '<span class="pill new">активен</span>' : '<span class="pill cancelled">скрыт</span>'}</td>
            <td>
              <button class="btn" data-edit="${p.id}"></button>
              ${p.active ? `<button class="btn danger" data-del="${p.id}"></button>` : ''}
            </td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="6" style="color:var(--muted)">Товаров пока нет</td></tr>';

  document.querySelectorAll('[data-edit]').forEach((b) =>
    (b.onclick = () => editProduct(Number(b.dataset.edit)))
  );
  document.querySelectorAll('[data-del]').forEach((b) =>
    (b.onclick = () => hideProduct(Number(b.dataset.del)))
  );
}

function fillProductForm(p) {
  const f = $('#productForm');
  f.id.value = p?.id || '';
  f.name.value = p?.name || '';
  f.category.value = p?.category || '';
  f.price.value = p?.price ?? '';
  f.stock.value = p?.stock ?? '';
  f.image_url.value = p?.image_url || '';
  f.description.value = p?.description || '';
  f.active.checked = p ? p.active : true;
  $('#productFormTitle').textContent = p ? `Редактировать: ${p.name}` : 'Добавить товар';
  $('#productMsg').textContent = '';
}

function editProduct(id) {
  fillProductForm(productsCache.find((p) => p.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function hideProduct(id) {
  if (!confirm('Скрыть товар из витрины?')) return;
  await api(`/api/admin/products/${id}`, { method: 'DELETE' });
  loadProducts();
}

$('#resetProduct').onclick = () => fillProductForm(null);

// Загрузка фото: файл уходит на сервер, в поле подставляется ссылка Cloudinary
$('#photoFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const msg = $('#productMsg');
  if (file.size > 4 * 1024 * 1024) return toastMsg(msg, 'Файл больше 4 МБ, выберите меньше');
  msg.textContent = 'Загружаем фото...';
  msg.style.color = 'var(--muted)';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
    const { url } = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    $('#productForm').image_url.value = url;
    toastMsg(msg, 'Фото загружено', true);
  } catch (err) {
    toastMsg(msg, err.message);
  }
};

$('#productForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.name.value,
    category: f.category.value,
    price: f.price.value,
    stock: f.stock.value,
    image_url: f.image_url.value,
    description: f.description.value,
    active: f.active.checked,
  };
  const id = f.id.value;
  const msg = $('#productMsg');
  try {
    let text;
    if (id) {
      await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      text = 'Товар обновлён';
    } else {
      await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
      text = 'Товар добавлен в каталог';
    }
    fillProductForm(null);
    toastMsg(msg, text, true);
    loadProducts();
  } catch (err) {
    toastMsg(msg, err.message);
  }
};

// ---------- Заказы ----------
async function loadOrders() {
  const orders = await api('/api/admin/orders');
  $('#ordersBody').innerHTML = orders.length
    ? orders
        .map((o) => {
          const items = o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join('<br>');
          const date = new Date(o.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
          const options = Object.entries(STATUS_LABELS)
            .map(([v, l]) => `<option value="${v}" ${v === o.status ? 'selected' : ''}>${l}</option>`)
            .join('');
          return `
            <tr>
              <td>${o.id}</td>
              <td>${date}</td>
              <td>${esc(o.customer_name)}<br><small style="color:var(--muted)">${esc(o.phone)}<br>${esc(o.address)}</small></td>
              <td style="font-size:.85rem">${items}</td>
              <td>${fmt(o.total)}</td>
              <td>
                <span class="pill ${o.status}">${STATUS_LABELS[o.status] || o.status}</span><br>
                <select data-order="${o.id}" style="margin-top:6px">${options}</select>
              </td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" style="color:var(--muted)">Заказов пока нет</td></tr>';

  document.querySelectorAll('[data-order]').forEach((sel) => {
    sel.onchange = async () => {
      await api(`/api/admin/orders/${sel.dataset.order}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: sel.value }),
      });
      loadOrders();
    };
  });
}

// ---------- Старт ----------
(async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  const { user } = await res.json();
  if (!user || user.role !== 'admin') {
    location.replace('/login?next=/admin');
    return;
  }
  $('#app').hidden = false;
  $('#adminName').textContent = user.name;
  loadStats();
})();
