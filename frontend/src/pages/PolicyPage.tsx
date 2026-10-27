import { Link } from 'react-router-dom'

export default function PolicyPage() {
  return (
    <div style={{ marginTop: 16, maxWidth: 640 }}>
      <h1 className="section-title" style={{ marginTop: 0 }}>Правила и гарантии</h1>

      <div className="glass-card" style={{ marginBottom: 14 }}>
        <h3>Доставка</h3>
        <p className="hint">Районы: Худжанд, Гафуров, Хистеварз, Овчикалача, Сартукай, Унчи, Бустон. Сумму доставки уточняет менеджер после оплаты товара (по тарифу курьера).</p>
      </div>

      <div className="glass-card" style={{ marginBottom: 14 }}>
        <h3>Оплата</h3>
        <p className="hint">DC, Эсхата / Visa, Telegram Stars. После перевода загрузите скрин чека — проверка обычно в течение нескольких часов.</p>
      </div>

      <div className="glass-card" style={{ marginBottom: 14 }}>
        <h3>Возврат</h3>
        <ul className="hint" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Если товар не соответствует описанию — возврат возможен в течение 3 дней после получения.</li>
          <li>Товар должен быть в исходном виде, с бирками.</li>
          <li>Брак по вине поставщика — замена или возврат оплаты.</li>
          <li>Отказ от доставки после выставления суммы — возврат оплаты товара (минус комиссия банка, если была).</li>
        </ul>
      </div>

      <div className="glass-card" style={{ marginBottom: 14 }}>
        <h3>Сроки из Китая</h3>
        <p className="hint">Обычно 14–30 дней до склада в Таджикистане. Точный статус смотрите в заказе — шкала обновляется в реальном времени.</p>
      </div>

      <Link to="/" className="btn-accent" style={{ display: 'inline-block', width: 'auto', padding: '10px 18px' }}>На главную</Link>
    </div>
  )
}
