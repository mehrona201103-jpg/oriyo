"""Ensure the 3 required payment methods always exist with correct codes."""
from sqlalchemy.orm import Session
from app.models.payment import PaymentMethod


REQUIRED = [
    {
        "code": "dc",
        "name": "DC (Душанбе Сити)",
        "recipient_name": "ORIYO",
        "account_number": "Укажите номер карты DC в админке",
        "instructions": "Переведите точную сумму на карту Душанбе Сити и загрузите скриншот чека.",
        "sort_order": 1,
    },
    {
        "code": "eskhata",
        "name": "Эсхата Онлайн (Visa)",
        "recipient_name": "ORIYO",
        "account_number": "Укажите реквизиты Эсхата / Visa в админке",
        "instructions": "Оплата через Эсхата Онлайн или карту Visa. Загрузите скриншот перевода.",
        "sort_order": 2,
    },
    {
        "code": "tg_stars",
        "name": "TG Звёзды (Telegram Gifts)",
        "recipient_name": "ORIYO Admin",
        "account_number": None,
        "instructions": "Курс: ~100 ⭐ ≈ $1.96. Откройте Telegram, отправьте подарки на сумму заказа, сделайте скрин и загрузите его в приложение.",
        "tg_username": "oriyo_admin",
        "tg_deep_link": "https://t.me/oriyo_admin",
        "sort_order": 3,
    },
]


def ensure_payment_methods(db: Session):
    for data in REQUIRED:
        existing = db.query(PaymentMethod).filter(PaymentMethod.code == data["code"]).first()
        if existing:
            # keep admin-edited account_number / recipient / instructions if set
            if not existing.name:
                existing.name = data["name"]
            existing.is_active = True
            if data.get("tg_deep_link") and not existing.tg_deep_link:
                existing.tg_deep_link = data["tg_deep_link"]
            if data.get("tg_username") and not existing.tg_username:
                existing.tg_username = data["tg_username"]
            continue
        # try match by name for old rows without code
        by_name = None
        if data["code"] == "dc":
            by_name = db.query(PaymentMethod).filter(PaymentMethod.name.ilike("%DC%") | PaymentMethod.name.ilike("%Душанбе%")).first()
        elif data["code"] == "eskhata":
            by_name = db.query(PaymentMethod).filter(PaymentMethod.name.ilike("%Эсхата%") | PaymentMethod.name.ilike("%Visa%")).first()
        elif data["code"] == "tg_stars":
            by_name = db.query(PaymentMethod).filter(PaymentMethod.name.ilike("%звезд%") | PaymentMethod.name.ilike("%TG%") | PaymentMethod.name.ilike("%Telegram%")).first()

        if by_name:
            by_name.code = data["code"]
            by_name.is_active = True
            if data.get("tg_deep_link"):
                by_name.tg_deep_link = by_name.tg_deep_link or data["tg_deep_link"]
            continue

        pm = PaymentMethod(
            code=data["code"],
            name=data["name"],
            recipient_name=data["recipient_name"],
            account_number=data.get("account_number"),
            instructions=data.get("instructions"),
            tg_username=data.get("tg_username"),
            tg_deep_link=data.get("tg_deep_link"),
            is_active=True,
            sort_order=data["sort_order"],
        )
        db.add(pm)
    db.commit()
