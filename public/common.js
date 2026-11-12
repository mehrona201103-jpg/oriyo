(function () {
  const O = (window.Oriyo = {});

  O.$ = (sel) => document.querySelector(sel);
  O.fmt = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;
  O.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  O.STATUS = {
    new: 'Принят',
    pending_payment: 'Ожидает оплаты',
    paid: 'Оплачен',
    shipped: 'Передан в доставку',
    delivered: 'Доставлен',
    cancelled: 'Отменён',
  };

  // Запросы к API: всегда с cookie, ошибки приходят с понятным текстом
  O.api = async (url, opts = {}) => {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || 'Ошибка сервера');
      err.status = res.status;
      throw err;
    }
    return body;
  };

  O.toast = (text, isError = false) => {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2600);
  };

  // Корзина хранится в браузере; цены и остатки подтягиваются с сервера
  const CART_KEY = 'oriyo-cart';
  O.cart = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      } catch {
        return [];
      }
    },
    set(items) {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
      window.dispatchEvent(new Event('cart:change'));
    },
    // Возвращает false, если товара больше нет на складе
    add(id, qty = 1, stock = Infinity) {
      const items = this.get();
      const line = items.find((l) => l.id === id);
      const current = line ? line.qty : 0;
      const next = Math.min(current + qty, stock, 99);
      if (next <= current) return false;
      if (line) line.qty = next;
      else items.push({ id, qty: next });
      this.set(items);
      return true;
    },
    setQty(id, qty) {
      const items = this.get()
        .map((l) => (l.id === id ? { ...l, qty } : l))
        .filter((l) => l.qty > 0);
      this.set(items);
    },
    count() {
      return this.get().reduce((s, l) => s + l.qty, 0);
    },
  };

  // Обложка товара: абстрактная планета, цвет зависит от id (без картинок-заглушек)
  O.cover = (id, imageUrl) => {
    if (imageUrl) return `<img src="${O.esc(imageUrl)}" alt="" class="cover-img" loading="lazy" />`;
    const h = (id * 53) % 360;
    const h2 = (h + 50) % 360;
    return `<svg viewBox="0 0 200 200" class="cover-svg" aria-hidden="true">
      <defs>
        <radialGradient id="cg${id}" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="hsl(${h} 30% 72%)"/>
          <stop offset="55%" stop-color="hsl(${h2} 25% 32%)"/>
          <stop offset="100%" stop-color="#06070d"/>
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill="#0c0e16"/>
      <circle cx="100" cy="100" r="56" fill="url(#cg${id})"/>
      <ellipse cx="100" cy="104" rx="88" ry="18" fill="none" stroke="hsl(${h} 20% 75% / .3)" stroke-width="1.2" transform="rotate(-14 100 104)"/>
    </svg>`;
  };

  // Слабый звёздный фон
  function starfield() {
    const canvas = document.createElement('canvas');
    canvas.className = 'starfield';
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');
    let stars = [];
    const resize = () => {
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      stars = Array.from({ length: Math.round(innerWidth / 9) }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.1 + 0.2,
        s: Math.random() * 0.12 + 0.02,
        a: Math.random() * Math.PI * 2,
      }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const st of stars) {
        st.y += st.s;
        st.a += 0.012;
        if (st.y > canvas.height) st.y = 0;
        ctx.globalAlpha = 0.25 + Math.sin(st.a) * 0.2;
        ctx.fillStyle = '#dfe6f5';
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(draw);
    };
    addEventListener('resize', resize);
    resize();
    draw();
  }

  // Шапка, корзина и данные о пользователе
  function mountChrome() {
    const header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML = `
      <div class="wrap header-inner">
        <a href="/" class="logo">ORIYO</a>
        <nav class="nav">
          <a href="/">Каталог</a>
          <a href="/login" id="navAccount">Войти</a>
          <button class="cart-btn" id="cartBtn" type="button">Корзина <span id="cartCount">0</span></button>
        </nav>
      </div>`;
    document.body.prepend(header);

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    document.body.appendChild(scrim);

    const drawer = document.createElement('aside');
    drawer.id = 'cart';
    drawer.className = 'drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <div class="drawer-head">
        <h2>Корзина</h2>
        <button class="close" id="closeCart" type="button" aria-label="Закрыть">×</button>
      </div>
      <div id="cartItems" class="cart-items"></div>
      <div class="drawer-foot">
        <div class="total-row"><span>Итого</span><strong id="cartTotal">0 ₽</strong></div>
        <a href="/checkout" class="btn primary block">Оформить заказ</a>
      </div>`;
    document.body.appendChild(drawer);

    const openCart = () => {
      drawer.classList.add('open');
      scrim.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
    };
    const closeCart = () => {
      drawer.classList.remove('open');
      scrim.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    };
    O.$('#cartBtn').onclick = openCart;
    O.$('#closeCart').onclick = closeCart;
    scrim.onclick = closeCart;
    document.addEventListener('keydown', (e) => e.key === 'Escape' && closeCart());

    async function renderCart() {
      const items = O.cart.get();
      O.$('#cartCount').textContent = O.cart.count();
      const list = O.$('#cartItems');
      list.innerHTML = '';

      if (!items.length) {
        list.innerHTML = `<div class="empty-state"><p>Корзина пуста</p><a href="/" class="btn" onclick="document.getElementById('cart').classList.remove('open')">В каталог</a></div>`;
        O.$('#cartTotal').textContent = O.fmt(0);
        return;
      }

      let products = [];
      try {
        products = await O.api(`/api/products?ids=${items.map((i) => i.id).join(',')}`);
      } catch {
        products = [];
      }
      const map = new Map(products.map((p) => [p.id, p]));
      let total = 0;

      items.forEach((line) => {
        const p = map.get(line.id);
        if (!p) return; // товар скрыт или удалён
        total += p.price * line.qty;
        const row = document.createElement('div');
        row.className = 'cart-line';
        row.innerHTML = `
          <div class="cart-cover">${O.cover(p.id, p.image_url)}</div>
          <div class="cart-info">
            <div class="cart-name">${O.esc(p.name)}</div>
            <div class="muted small">${O.fmt(p.price)}</div>
            <div class="qty">
              <button type="button" data-d="-1" aria-label="Уменьшить">−</button>
              <span>${line.qty}</span>
              <button type="button" data-d="1" aria-label="Увеличить">+</button>
            </div>
          </div>
          <button type="button" class="remove" aria-label="Удалить">×</button>`;
        row.querySelectorAll('[data-d]').forEach((b) =>
          (b.onclick = () => {
            const next = line.qty + Number(b.dataset.d);
            if (next > p.stock) return O.toast('Больше нет на складе', true);
            O.cart.setQty(line.id, next);
          })
        );
        row.querySelector('.remove').onclick = () => O.cart.setQty(line.id, 0);
        list.appendChild(row);
      });

      O.$('#cartTotal').textContent = O.fmt(total);
    }

    window.addEventListener('cart:change', renderCart);
    renderCart();
    O.renderCart = renderCart;
  }

  // Ready-промис: страницы ждут, пока станет известно, вошёл ли пользователь
  O.ready = (async () => {
    mountChrome();
    try {
      O.me = (await O.api('/api/auth/me')).user;
    } catch {
      O.me = null;
    }
    if (O.me) {
      const link = O.$('#navAccount');
      if (O.me.role === 'admin') {
        link.textContent = 'Админ-панель';
        link.href = '/admin';
      } else {
        link.textContent = 'Кабинет';
        link.href = '/account';
      }
    }
    starfield();
  })();
})();
