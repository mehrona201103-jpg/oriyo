(async function () {
  const O = window.Oriyo;
  const $ = O.$;
  await O.ready;

  const id = parseInt(new URLSearchParams(location.search).get('id'), 10);

  function notFound() {
    $('#notFound').hidden = false;
  }

  if (!Number.isInteger(id)) return notFound();

  let p;
  try {
    p = await O.api('/api/products/' + id);
  } catch {
    return notFound();
  }

  document.title = `${p.name} — Oriyo`;
  $('#crumb').textContent = p.name;

  const root = $('#product');
  root.hidden = false;
  const maxQty = Math.min(p.stock, 99);
  let qty = p.stock > 0 ? 1 : 0;

  root.innerHTML = `
    <div class="product-media">${O.cover(p.id, p.image_url)}</div>
    <div class="product-info">
      <p class="eyebrow">${O.esc(p.category)}</p>
      <h1>${O.esc(p.name)}</h1>
      <p class="product-desc">${O.esc(p.description)}</p>
      <div class="price big">${O.fmt(p.price)}</div>
      <p class="stock-line ${p.stock > 0 ? 'in' : 'out'}">
        ${p.stock > 0 ? 'В наличии' : 'Нет в наличии'}
      </p>
      <div class="qty-row">
        <span>Количество</span>
        <div class="qty">
          <button type="button" id="minus" aria-label="Уменьшить">−</button>
          <span id="qtyVal">${qty}</span>
          <button type="button" id="plus" aria-label="Увеличить">+</button>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn primary block lg" id="addBtn" ${p.stock <= 0 ? 'disabled' : ''}>
          Добавить в корзину
        </button>
        <button type="button" class="btn block lg" id="buyBtn" ${p.stock <= 0 ? 'disabled' : ''}>
          Купить сейчас
        </button>
      </div>
      <div class="perks">
        <span>Доставка курьером или самовывоз</span>
        <span>Оплата при получении</span>
        <span>Возврат в течение 14 дней</span>
      </div>
    </div>`;

  const updateQty = () => ($('#qtyVal').textContent = qty);
  $('#minus').onclick = () => {
    if (qty > 1) qty -= 1;
    updateQty();
  };
  $('#plus').onclick = () => {
    if (qty < maxQty) qty += 1;
    else O.toast('Больше нет на складе', true);
    updateQty();
  };

  function addToCart() {
    // Количество, которое уже лежит в корзине, учитывается в лимите склада
    const inCart = O.cart.get().find((l) => l.id === p.id);
    const already = inCart ? inCart.qty : 0;
    if (already + qty > maxQty) {
      O.toast('Столько товара нет на складе', true);
      return false;
    }
    return O.cart.add(p.id, qty, p.stock);
  }

  $('#addBtn').onclick = () => {
    if (addToCart()) O.toast(`Добавлено: ${qty} шт.`);
  };

  $('#buyBtn').onclick = () => {
    if (addToCart()) location.href = '/checkout';
  };
})().catch((err) => window.Oriyo.toast(err.message, true));
