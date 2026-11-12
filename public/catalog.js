(async function () {
  const O = window.Oriyo;
  const $ = O.$;
  await O.ready;

  const params = new URLSearchParams(location.search);
  const state = { category: '', q: params.get('q') || '' };
  $('#search').value = state.q;

  async function loadCategories() {
    const cats = await O.api('/api/categories');
    const nav = $('#categories');
    nav.innerHTML = '';
    ['', ...cats].forEach((cat) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.category === cat ? ' active' : '');
      b.textContent = cat || 'Все товары';
      b.onclick = () => {
        state.category = cat;
        loadCategories();
        loadProducts();
      };
      nav.appendChild(b);
    });
  }

  async function loadProducts() {
    const p = new URLSearchParams();
    if (state.category) p.set('category', state.category);
    if (state.q) p.set('q', state.q);
    render(await O.api('/api/products?' + p.toString()));
  }

  function render(items) {
    const grid = $('#catalog');
    grid.innerHTML = '';
    $('#empty').hidden = items.length > 0;

    items.forEach((p) => {
      const art = document.createElement('article');
      art.className = 'card';
      const soldOut = p.stock <= 0;
      art.innerHTML = `
        <a href="/product?id=${p.id}" class="card-media" aria-label="${O.esc(p.name)}">${O.cover(p.id, p.image_url)}</a>
        <div class="card-body">
          <a href="/product?id=${p.id}" class="card-title">${O.esc(p.name)}</a>
          <p class="card-desc">${O.esc(p.description)}</p>
          <div class="card-foot">
            <span class="price">${O.fmt(p.price)}</span>
            <button type="button" class="btn small-btn" ${soldOut ? 'disabled' : ''}>
              ${soldOut ? 'Нет в наличии' : 'В корзину'}
            </button>
          </div>
        </div>`;
      art.querySelector('button').onclick = () => {
        if (O.cart.add(p.id, 1, p.stock)) O.toast('Добавлено в корзину');
        else O.toast('Больше нет на складе', true);
      };
      grid.appendChild(art);
    });
  }

  let timer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value.trim();
      loadProducts();
    }, 250);
  });

  await loadCategories();
  await loadProducts();
})().catch((err) => window.Oriyo.toast(err.message, true));
