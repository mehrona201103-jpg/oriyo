import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
// Администратор создаётся из FIRST_OWNER_EMAIL и FIRST_OWNER_PASSWORD при каждом запуске
const SESSION_COOKIE = 'oriyo_session';
const SESSION_DAYS = 30;

// Railway: DATABASE_URL подставляется из плагина PostgreSQL.
// Для внутренней сети Railway SSL не нужен; для публичного адреса задайте PGSSL=true.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Stripe ----------
// STRIPE_SECRET_KEY — секретный ключ (sk_test_... для тестов, sk_live_... для продажи)
// STRIPE_WEBHOOK_SECRET — секрет webhook (whsec_...), создаётся при регистрации endpoint
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_CURRENCY = (process.env.STRIPE_CURRENCY || 'rub').toLowerCase();

// Stripe принимает данные в формате form-urlencoded, вложенные поля через [ ]
function flattenForm(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') flattenForm(item, `${key}[${i}]`, out);
        else out[`${key}[${i}]`] = String(item);
      });
    } else if (typeof v === 'object') {
      flattenForm(v, key, out);
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

async function stripeRequest(method, endpoint, params) {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(flattenForm(params)).toString() : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Ошибка платёжной системы');
  return data;
}

// Проверка подписи webhook по инструкции Stripe (HMAC-SHA256, допуск 5 минут)
function verifyStripeSignature(rawBody, header) {
  if (!STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

// ---------- Пароли ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
}

// Простой лимит попыток входа (в памяти одного процесса)
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) {
    attempts.set(key, { count: 1, reset: now + 15 * 60 * 1000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 10;
}

// ---------- Запрещённые товары ----------
// Список согласуйте с юристом и правилами платёжного провайдера.
const BANNED_KEYWORDS = [
  'оружие', 'оружия', 'пистолет', 'автомат', 'патрон', 'боеприпас', 'взрывчат',
  'наркот', 'психотроп', 'героин', 'кокаин', 'марихуан', 'каннабис',
  'поддельн', 'фальшивые деньги', 'фальшивк', 'краденое', 'украденн',
  'поддельные документы', 'фальшивый паспорт', 'хакерск', 'кейлоггер',
  'органы человека', 'человеческие органы', 'живые животные',
  'weapon', 'firearm', 'explosive', 'drug', 'cocaine', 'counterfeit', 'stolen',
];

function findBannedWord(...texts) {
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  return BANNED_KEYWORDS.find((word) => haystack.includes(word)) || null;
}

// ---------- Уведомления в Telegram (необязательно) ----------
async function notifyNewOrder(orderId, customer, items, total, delivery, payment) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  const lines = items.map((i) => `• ${i.name} × ${i.qty}`).join('\n');
  const text =
    `Новый заказ №${orderId}\n${lines}\n` +
    `Сумма: ${total.toLocaleString('ru-RU')} ₽\n` +
    `Клиент: ${customer.name}, ${customer.phone}\n` +
    `Получение: ${delivery === 'pickup' ? 'самовывоз' : 'курьер, ' + customer.address}\n` +
    `Оплата: ${payment === 'cod' ? 'при получении' : payment}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error('Telegram: не удалось отправить уведомление', err.message);
  }
}

// ---------- Инициализация БД ----------
const DEMO_PRODUCTS = [
  ['Наушники беспроводные ANC', 'Шумоподавление, до 30 часов работы, быстрая зарядка USB-C', 7990, 'Электроника', 20],
  ['Термокружка 500 мл', 'Держит тепло до 6 часов, герметичная крышка', 1290, 'Дом', 35],
  ['Рюкзак городской 25 л', 'Отделение для ноутбука 16", водоотталкивающая ткань', 4590, 'Аксессуары', 12],
  ['Настольная лампа с LED', 'Три режима света, регулировка яркости, порт USB', 2790, 'Дом', 18],
  ['Худи унисекс', 'Плотный хлопок 380 г/м², свободный крой', 3490, 'Одежда', 25],
  ['Книга «Навигация по звёздам»', 'Иллюстрированное издание, твёрдый переплёт', 1890, 'Книги', 10],
];

// Колонки, которые нужны нашему коду
const REQUIRED_COLUMNS = {
  products: ['id', 'name', 'description', 'price', 'category', 'image_url', 'stock', 'active'],
  users: ['id', 'email', 'name', 'phone', 'password_hash'],
  sessions: ['token_hash', 'user_id', 'expires_at'],
  orders: ['id', 'customer_name', 'phone', 'address', 'items', 'total', 'status'],
};

// Если в базе уже есть таблица с другой структурой (от старой версии или другого приложения),
// переносим её в схему legacy_<дата>, а не удаляем. Данные остаются доступны.
async function moveIncompatibleTables() {
  let schema = null;
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    if (!rows.length) continue;
    const have = new Set(rows.map((r) => r.column_name));
    if (required.every((c) => have.has(c))) continue;

    if (!schema) {
      schema = `legacy_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now() % 100000}`;
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    }
    // Переносим и связанную последовательность id, чтобы имена не конфликтовали
    await pool.query(`ALTER TABLE "${table}" SET SCHEMA "${schema}"`);
    await pool.query(
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '${table}_id_seq' AND relkind = 'S'
                    AND relnamespace = 'public'::regnamespace) THEN
           ALTER SEQUENCE public."${table}_id_seq" SET SCHEMA "${schema}";
         END IF;
       END $$;`
    );
    console.warn(`Таблица ${table} имела другую структуру и перенесена в схему ${schema}`);
  }
}

async function initDb() {
  await moveIncompatibleTables();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price INTEGER NOT NULL CHECK (price >= 0),
      category TEXT DEFAULT 'Прочее',
      image_url TEXT DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      items JSONB NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment TEXT NOT NULL DEFAULT 'cod';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery TEXT NOT NULL DEFAULT 'courier';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee INTEGER NOT NULL DEFAULT 0;
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM products');
  if (rows[0].c === 0) {
    for (const [name, description, price, category, stock] of DEMO_PRODUCTS) {
      await pool.query(
        'INSERT INTO products (name, description, price, category, stock) VALUES ($1,$2,$3,$4,$5)',
        [name, description, price, category, stock]
      );
    }
    console.log('Демо-товары добавлены');
  }
}

// Администратор из FIRST_OWNER_EMAIL / FIRST_OWNER_PASSWORD.
// Если пользователь уже есть, ему выдаётся роль admin, а пароль обновляется,
// если он отличается от переменной. Так можно сменить пароль, изменив переменную.
async function ensureOwner() {
  const email = (process.env.FIRST_OWNER_EMAIL || '').trim().toLowerCase();
  const password = process.env.FIRST_OWNER_PASSWORD || '';
  if (!email || !password) {
    console.warn('FIRST_OWNER_EMAIL или FIRST_OWNER_PASSWORD не заданы: администратор не создан');
    return;
  }
  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  if (!rows[0]) {
    await pool.query(
      `INSERT INTO users (email, name, phone, password_hash, role)
       VALUES ($1, 'Администратор', '', $2, 'admin')`,
      [email, hashPassword(password)]
    );
    console.log('Администратор создан');
    return;
  }
  await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [rows[0].id]);
  if (!verifyPassword(password, rows[0].password_hash)) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), rows[0].id]);
    console.log('Пароль администратора обновлён из FIRST_OWNER_PASSWORD');
  }
}

// ---------- Приложение ----------
const app = express();
app.set('trust proxy', 1); // Railway работает за прокси: нужны правильный IP и secure-cookie
// Webhook Stripe: нужно сырое тело для проверки подписи, поэтому до express.json
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verifyStripeSignature(rawBody, req.get('stripe-signature'))) {
    return res.status(400).json({ error: 'Неверная подпись' });
  }

  const event = JSON.parse(rawBody);
  const session = event.data?.object || {};
  const orderId = Number(session.metadata?.order_id);

  try {
    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid' && orderId) {
      const { rows } = await pool.query(
        `UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'pending_payment' RETURNING *`,
        [orderId]
      );
      if (rows[0]) {
        const o = rows[0];
        notifyNewOrder(o.id, { name: o.customer_name, phone: o.phone, address: o.address }, o.items, o.total, o.delivery, 'оплачено онлайн');
      }
    }

    // Сессия оплаты истекла: отменяем заказ и возвращаем товары на склад
    if (event.type === 'checkout.session.expired' && orderId) {
      const { rows } = await pool.query(
        `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending_payment' RETURNING items`,
        [orderId]
      );
      for (const item of rows[0]?.items || []) {
        await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.qty, item.id]);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook:', err);
    res.status(500).json({ error: 'Ошибка обработки' });
  }
});

app.use(express.json({ limit: '6mb' })); // фото товаров приходят в base64

// Определяем пользователя по cookie-сессии
function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf('=');
        return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
      })
  );
}

app.use(async (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  req.user = null;
  if (token) {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.phone, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [sha256(token)]
    );
    req.user = rows[0] || null;
  }
  next();
});

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [
    sha256(token),
    userId,
    expires,
  ]);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${IS_PROD ? '; Secure' : ''}`
  );
}

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ---------- Аккаунт покупателя ----------
app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');

  if (name.split(' ').filter(Boolean).length < 2) {
    return res.status(400).json({ error: 'Укажите фамилию и имя полностью' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return res.status(400).json({ error: 'Укажите корректный номер телефона' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, phone, password_hash) VALUES ($1,$2,$3,$4)
       RETURNING id, email, name, phone, role`,
      [email, name, phone, hashPassword(password)]
    );
    await startSession(res, rows[0].id);
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    throw err;
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (tooManyAttempts('login:' + req.ip)) {
    return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 15 минут' });
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query(
    'SELECT id, email, name, phone, role, password_hash FROM users WHERE email = $1',
    [email]
  );
  const u = rows[0];
  if (!u || !verifyPassword(password, u.password_hash)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  await startSession(res, u.id);
  res.json({ user: { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role } });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

app.get('/api/account/orders', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Войдите в аккаунт' });
  const { rows } = await pool.query(
    `SELECT id, items, total, status, delivery, payment, created_at
     FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// ---------- Каталог ----------
app.get('/api/products', async (req, res) => {
  const { category, q, ids } = req.query;
  const params = [];
  const conds = ['active = TRUE'];
  if (category) {
    params.push(String(category));
    conds.push(`category = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conds.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }
  if (ids) {
    const list = String(ids).split(',').map(Number).filter(Number.isInteger);
    params.push(list);
    conds.push(`id = ANY($${params.length})`);
  }
  const { rows } = await pool.query(
    `SELECT id, name, description, price, category, image_url, stock
     FROM products WHERE ${conds.join(' AND ')} ORDER BY id DESC`,
    params
  );
  res.json(rows);
});

app.get('/api/products/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Товар не найден' });
  const { rows } = await pool.query(
    `SELECT id, name, description, price, category, image_url, stock
     FROM products WHERE id = $1 AND active = TRUE`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Товар не найден' });
  res.json(rows[0]);
});

app.get('/api/categories', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT DISTINCT category FROM products WHERE active = TRUE ORDER BY category'
  );
  res.json(rows.map((r) => r.category));
});

// ---------- Оформление заказа ----------
// Доставка только курьером на дом; стоимость доставки оплачивает клиент
const DELIVERY_FEE = Math.max(0, Number(process.env.DELIVERY_FEE || 350));

app.get('/api/config', (req, res) =>
  res.json({ deliveryFee: DELIVERY_FEE, stripeEnabled: Boolean(STRIPE_SECRET_KEY), currency: STRIPE_CURRENCY })
);

// Заказ может оформить только зарегистрированный пользователь. Цены и остатки берутся из базы.
app.post('/api/orders', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Войдите или зарегистрируйтесь, чтобы оформить заказ' });
  }

  const body = req.body || {};
  const payment = body.payment === 'card' ? 'card' : 'cod';
  const name = String(body.name || req.user.name || '').trim().replace(/\s+/g, ' ');
  const phone = String(body.phone || req.user.phone || '').trim();
  const email = String(body.email || req.user.email || '').trim();
  const address = String(body.address || '').trim();

  if (name.split(' ').filter(Boolean).length < 2) return res.status(400).json({ error: 'Укажите ФИО' });
  if (phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Укажите телефон' });
  if (address.length < 10) return res.status(400).json({ error: 'Укажите адрес доставки: улицу, дом, квартиру' });
  if (payment === 'card' && !STRIPE_SECRET_KEY) {
    return res.status(400).json({ error: 'Онлайн-оплата пока недоступна, выберите оплату при получении' });
  }

  const lines = Array.isArray(body.items)
    ? body.items.map((i) => ({ id: Number(i.id), qty: parseInt(i.qty, 10) }))
    : [];
  if (!lines.length || lines.some((l) => !Number.isInteger(l.id) || l.qty < 1 || l.qty > 99)) {
    return res.status(400).json({ error: 'Корзина пуста или содержит ошибки' });
  }

  const cust = { name, phone, email, address };
  let orderId;
  let orderItems = [];
  let goodsTotal = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: products } = await client.query(
      'SELECT id, name, price, stock FROM products WHERE id = ANY($1) AND active = TRUE FOR UPDATE',
      [lines.map((l) => l.id)]
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const line of lines) {
      const product = byId.get(line.id);
      if (!product) throw new Error('Один из товаров больше недоступен');
      if (product.stock < line.qty) throw new Error(`Недостаточно товара «${product.name}» на складе`);
      orderItems.push({ id: product.id, name: product.name, price: product.price, qty: line.qty });
      goodsTotal += product.price * line.qty;
    }

    for (const item of orderItems) {
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.qty, item.id]);
    }

    const total = goodsTotal + DELIVERY_FEE;
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (customer_name, phone, email, address, items, total, user_id, payment, delivery, status, delivery_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'courier',$9,$10) RETURNING id`,
      [
        cust.name,
        cust.phone,
        cust.email,
        cust.address,
        JSON.stringify(orderItems),
        total,
        req.user.id,
        payment,
        payment === 'card' ? 'pending_payment' : 'new',
        DELIVERY_FEE,
      ]
    );
    await client.query('COMMIT');
    orderId = orderRows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }

  const total = goodsTotal + DELIVERY_FEE;

  // Для карты создаём сессию Stripe: товары + доставка отдельной строкой
  if (payment === 'card') {
    try {
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await stripeRequest('POST', 'checkout/sessions', {
        mode: 'payment',
        customer_email: cust.email || undefined,
        client_reference_id: String(orderId),
        metadata: { order_id: String(orderId) },
        line_items: [
          ...orderItems.map((i) => ({
            quantity: i.qty,
            price_data: { currency: STRIPE_CURRENCY, unit_amount: i.price * 100, product_data: { name: i.name } },
          })),
          {
            quantity: 1,
            price_data: {
              currency: STRIPE_CURRENCY,
              unit_amount: DELIVERY_FEE * 100,
              product_data: { name: 'Доставка курьером на дом' },
            },
          },
        ],
        success_url: `${origin}/order-success?order=${orderId}`,
        cancel_url: `${origin}/checkout?cancelled=1`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      });
      await pool.query('UPDATE orders SET stripe_session_id = $1 WHERE id = $2', [session.id, orderId]);
      return res.status(201).json({ orderId, total, paymentUrl: session.url });
    } catch (err) {
      console.error('Stripe checkout:', err.message);
      return res.status(502).json({
        error: 'Не удалось открыть оплату. Заказ сохранён: выберите оплату при получении или повторите позже',
      });
    }
  }

  notifyNewOrder(orderId, cust, orderItems, total, 'courier', payment);
  res.status(201).json({ orderId, total });
});

// ---------- Загрузка фото товаров в Cloudinary ----------
// CLOUDINARY_URL вида cloudinary://API_KEY:API_SECRET@CLOUD_NAME (из настроек Cloudinary)
const CLOUDINARY_URL = process.env.CLOUDINARY_URL || '';

function parseCloudinaryUrl(url) {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  return m ? { key: m[1], secret: m[2], cloud: m[3] } : null;
}

app.post('/api/admin/upload', requireAdmin, async (req, res) => {
  const cfg = parseCloudinaryUrl(CLOUDINARY_URL);
  if (!cfg) return res.status(400).json({ error: 'Загрузка фото не настроена: добавьте CLOUDINARY_URL' });

  const dataUrl = req.body?.dataUrl;
  if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) {
    return res.status(400).json({ error: 'Нужен файл PNG, JPEG или WebP' });
  }

  // Подпись по правилам Cloudinary: параметры по алфавиту + секрет, затем SHA-1
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'oriyo/products';
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${cfg.secret}`)
    .digest('hex');

  const form = new URLSearchParams({
    file: dataUrl,
    api_key: cfg.key,
    timestamp: String(timestamp),
    folder,
    signature,
  });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloud}/image/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(400).json({ error: data.error?.message || 'Ошибка загрузки фото' });
  res.json({ url: data.secure_url });
});

// ---------- Админ-панель API ----------
// Доступ к админ-API только у пользователя с ролью admin
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Войдите в аккаунт' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
  next();
}

app.get('/api/admin/products', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM products ORDER BY id DESC');
  res.json(rows);
});

function validateProduct(body) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || 'Прочее').trim();
  const price = parseInt(body.price, 10);
  const stock = parseInt(body.stock, 10);
  const image_url = String(body.image_url || '').trim();

  if (!name) return { error: 'Укажите название' };
  if (!Number.isInteger(price) || price < 0) return { error: 'Некорректная цена' };
  if (!Number.isInteger(stock) || stock < 0) return { error: 'Некорректный остаток' };

  const banned = findBannedWord(name, description, category);
  if (banned) return { error: `Товар запрещён к продаже (найдено: «${banned}»)` };

  return { value: { name, description, category, price, stock, image_url } };
}

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const check = validateProduct(req.body);
  if (check.error) return res.status(400).json({ error: check.error });
  const p = check.value;
  const { rows } = await pool.query(
    `INSERT INTO products (name, description, price, category, image_url, stock)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [p.name, p.description, p.price, p.category, p.image_url, p.stock]
  );
  res.status(201).json(rows[0]);
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const check = validateProduct(req.body);
  if (check.error) return res.status(400).json({ error: check.error });
  const p = check.value;
  const active = req.body.active !== false;
  const { rows } = await pool.query(
    `UPDATE products SET name=$1, description=$2, price=$3, category=$4,
       image_url=$5, stock=$6, active=$7 WHERE id=$8 RETURNING *`,
    [p.name, p.description, p.price, p.category, p.image_url, p.stock, active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Товар не найден' });
  res.json(rows[0]);
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  await pool.query('UPDATE products SET active = FALSE WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = 'TRUE';
  if (status) {
    params.push(status);
    where = 'status = $1';
  }
  const { rows } = await pool.query(
    `SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  res.json(rows);
});

const ORDER_STATUSES = ['new', 'pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];

app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Неизвестный статус' });
  const { rows } = await pool.query(
    'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Заказ не найден' });
  res.json(rows[0]);
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const [totals, daily, top, statuses, products, customers] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS orders,
        COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'), 0)::int AS revenue,
        COALESCE(AVG(total) FILTER (WHERE status <> 'cancelled'), 0)::int AS avg_check,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS orders_24h
      FROM orders`),
    pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS orders,
             COALESCE(SUM(total), 0)::int AS revenue
      FROM orders
      WHERE created_at > NOW() - INTERVAL '14 days' AND status <> 'cancelled'
      GROUP BY 1 ORDER BY 1`),
    pool.query(`
      SELECT item->>'name' AS name,
             SUM((item->>'qty')::int)::int AS qty,
             SUM((item->>'qty')::int * (item->>'price')::int)::int AS revenue
      FROM orders, jsonb_array_elements(items) AS item
      WHERE status <> 'cancelled'
      GROUP BY 1 ORDER BY revenue DESC LIMIT 5`),
    pool.query('SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status'),
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE active)::int AS active,
             COUNT(*) FILTER (WHERE active AND stock <= 3)::int AS low_stock
      FROM products`),
    pool.query('SELECT COUNT(*)::int AS count FROM users'),
  ]);

  res.json({
    ...totals.rows[0],
    customers: customers.rows[0].count,
    products: products.rows[0],
    daily: daily.rows,
    top: top.rows,
    statuses: statuses.rows,
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Общий обработчик ошибок: лог и понятный ответ, процесс не падает
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
  console.error('Ошибка запроса:', req.method, req.url, err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

process.on('unhandledRejection', (err) => console.error('Необработанная ошибка:', err));

initDb()
  .then(ensureOwner)
  .then(() => {
    app.listen(PORT, () => console.log(`Oriyo запущен на порту ${PORT}`));
  })
  .catch((err) => {
    console.error('Ошибка запуска БД:', err);
    process.exit(1);
  });
