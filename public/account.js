(async function () {
  const O = window.Oriyo;
  const $ = O.$;
  await O.ready;

  if (!O.me) {
    location.replace('/login?next=/account');
    return;
  }

  $('#userName').textContent = O.me.name;
  $('#userEmail').textContent = O.me.email;
  $('#userPhone').textContent = O.me.phone || 'Телефон не указан';

  const box = $('#orders');
  const orders = await O.api('/api/account/orders');

  if (!orders.length) {
    box.innerHTML = `
      <div class="empty-state" style="padding:24px 0">
        <p>Заказов пока нет.</p>
        <a href="/" class="btn">Перейти в каталог</a>
      </div>`;
  } else {
    box.innerHTML = orders
      .map((o) => {
        const date = new Date(o.created_at).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        const items = o.items.map((i) => `${O.esc(i.name)} × ${i.qty}`).join('<br>');
        const delivery = o.delivery === 'pickup' ? 'Самовывоз' : 'Курьер';
        return `
          <article class="order">
            <div class="order-head">
              <strong>Заказ №${o.id}</strong>
              <span class="pill ${o.status}">${O.STATUS[o.status] || o.status}</span>
            </div>
            <div class="muted small">${date} · ${delivery} · Оплата при получении</div>
            <div class="order-items">${items}</div>
            <div class="price">${O.fmt(o.total)}</div>
          </article>`;
      })
      .join('');
  }

  $('#logout').onclick = async () => {
    await O.api('/api/auth/logout', { method: 'POST' });
    O.me = null;
    location.href = '/';
  };
})().catch((err) => window.Oriyo.toast(err.message, true));
