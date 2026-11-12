(async function () {
  const O = window.Oriyo;
  const $ = O.$;
  const mode = document.body.dataset.mode; // 'login' | 'register'
  await O.ready;

  // Куда вернуть пользователя после входа (только внутри сайта)
  function safeNext() {
    const n = new URLSearchParams(location.search).get('next');
    return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
  }

  if (O.me) {
    location.replace(safeNext() || (O.me.role === 'admin' ? '/admin' : '/account'));
    return;
  }

  const form = $('#authForm');
  const msg = $('#msg');
  const btn = $('#submitBtn');

  form.onsubmit = async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const data = Object.fromEntries(new FormData(form));

    if (!form.checkValidity()) {
      msg.textContent = 'Проверьте заполнение полей';
      return;
    }

    btn.disabled = true;
    btn.textContent = mode === 'login' ? 'Входим...' : 'Создаём...';
    try {
      const res = await O.api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      // Администратор сразу попадает в панель, покупатель — в кабинет
      const fallback = res.user.role === 'admin' ? '/admin' : '/account';
      location.href = safeNext() || fallback;
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
      btn.textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
    }
  };
})().catch((err) => window.Oriyo.toast(err.message, true));
