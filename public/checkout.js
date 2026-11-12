(async function () {
  const O = window.Oriyo;
  const $ = O.$;
  await O.ready;

  const form = $('#form');
  const msg = $('#msg');
  const btn = $('#submitBtn');

  if (new URLSearchParams(location.search).get('cancelled')) {
    msg.textContent = 'Оплата отменена. Можно оформить заказ снова или выбрать оплату при получении.';
  }

  // Гость не может оформить заказ
  if (!O.me) {
    $('#authGate').hidden = false;
    return;
  }

  const items = O.cart.get();
  if (!items.length) {
    $('#emptyCart').hidden = false;
    return;
  }

  const config = await O.api('/api/config');
  const products = await O.api(`/api/products?ids=${items.map((i) => i.id).join(',')}`);
  const map = new Map(products.map((p) => [p.id, p]));

  $('#checkoutWrap').hidden = false;

  // Предзаполнение из профиля
  form.name.value = O.me.name || '';
  form.phone.value = O.me.phone || '';
  form.email.value = O.me.email || '';

  // Онлайн-оплата только если Stripe подключён на сервере
  if (!config.stripeEnabled) {
    form.payment[1].disabled = true;
    $('#cardOption').classList.add('disabled');
    $('#cardHint').textContent = 'Скоро, пока доступна оплата при получении';
  }

  function renderSummary() {
    let goods = 0;
    const lines = O.cart
      .get()
      .map((l) => {
        const p = map.get(l.id);
        if (!p) return '';
        goods += p.price * l.qty;
        return `<div class="summary-line"><span>${O.esc(p.name)} × ${l.qty}</span><span>${O.fmt(p.price * l.qty)}</span></div>`;
      })
      .join('');
    const total = goods + config.deliveryFee;
    $('#summary').innerHTML = `
      <h2>Ваш заказ</h2>
      ${lines || '<p class="muted small">Товары больше недоступны</p>'}
      <hr />
      <div class="summary-line"><span>Товары</span><span>${O.fmt(goods)}</span></div>
      <div class="summary-line"><span>Доставка курьером</span><span>${O.fmt(config.deliveryFee)}</span></div>
      <div class="summary-line"><span>К оплате</span><span class="total-amount">${O.fmt(total)}</span></div>`;
  }
  renderSummary();

  form.onsubmit = async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    if (!data.name || !data.phone || !data.address) {
      msg.textContent = 'Заполните ФИО, телефон и адрес доставки';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Оформляем...';
    try {
      const res = await O.api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          phone: data.phone,
          email: data.email,
          address: data.address,
          payment: data.payment,
          items: O.cart.get(),
        }),
      });

      if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
        return;
      }
      O.cart.set([]);
      showDone(res.orderId, res.total);
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Оформить заказ';
    }
  };

  function showDone(orderId, total) {
    $('#checkoutWrap').hidden = true;
    const done = $('#done');
    done.hidden = false;
    done.innerHTML = `
      <p class="eyebrow">Заказ принят</p>
      <h1>Заказ №${orderId}</h1>
      <p class="muted">Сумма ${O.fmt(total)} с доставкой. Мы свяжемся с вами по телефону, чтобы согласовать время доставки.</p>
      <div class="row" style="justify-content:center; margin-top:10px">
        <a href="/account" class="btn">Мои заказы</a>
        <a href="/" class="btn primary">Продолжить покупки</a>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
})().catch((err) => window.Oriyo.toast(err.message, true));
