"""Telegram notifications + keyboards."""
from typing import Any
import httpx
from app.core.config import settings

STATUS_RU = {
    "awaiting_payment": "Ожидает оплаты",
    "payment_review": "Проверка оплаты",
    "paid": "Оплачен",
    "processing": "В обработке",
    "ordered_from_supplier": "Заказан у поставщика",
    "in_transit": "В пути",
    "arrived_in_tajikistan": "Прибыл в Таджикистан",
    "ready_for_pickup": "Готов к выдаче",
    "out_for_delivery": "У курьера",
    "delivered": "Доставлен",
    "cancelled": "Отменён",
    "refunded": "Возврат",
}


def status_ru(code: str) -> str:
    if not code:
        return "—"
    key = code.value if hasattr(code, "value") else str(code)
    return STATUS_RU.get(key, key)


def main_menu_keyboard() -> dict:
    """Inline buttons in chat (not bottom reply panel)."""
    return {
        "inline_keyboard": [
            [
                {"text": "📦 Мои заказы", "callback_data": "menu:orders"},
                {"text": "🔍 Статус заказа", "callback_data": "menu:track"},
            ],
            [
                {"text": "🛍 Поиск товара", "callback_data": "menu:search"},
                {"text": "ℹ️ Помощь", "callback_data": "menu:help"},
            ],
            [
                {"text": "🌐 Открыть ORIYO", "url": "https://oriyo.up.railway.app"},
            ],
        ]
    }


def send_telegram_sync(
    chat_id: str | int,
    text: str,
    reply_markup: dict | None = None,
) -> bool:
    token = getattr(settings, "TELEGRAM_BOT_TOKEN", None) or ""
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload: dict[str, Any] = {
        "chat_id": str(chat_id),
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        with httpx.Client(timeout=10) as client:
            r = client.post(url, json=payload)
            if r.status_code != 200:
                print("[ORIYO] telegram API:", r.status_code, r.text[:300])
            return r.status_code == 200
    except Exception as e:
        print("[ORIYO] telegram error:", e)
        return False


def answer_callback(callback_query_id: str, text: str = "") -> bool:
    token = getattr(settings, "TELEGRAM_BOT_TOKEN", None) or ""
    if not token or not callback_query_id:
        return False
    url = f"https://api.telegram.org/bot{token}/answerCallbackQuery"
    try:
        with httpx.Client(timeout=10) as client:
            r = client.post(url, json={"callback_query_id": callback_query_id, "text": text})
            return r.status_code == 200
    except Exception as e:
        print("[ORIYO] callback error:", e)
        return False


def notify_admin(text: str) -> bool:
    chat = getattr(settings, "TELEGRAM_ADMIN_CHAT_ID", None) or ""
    return send_telegram_sync(chat, text)


def notify_user_telegram(chat_id: str | None, text: str, with_menu: bool = False) -> bool:
    if not chat_id:
        return False
    kb = main_menu_keyboard() if with_menu else None
    return send_telegram_sync(chat_id, text, reply_markup=kb)
