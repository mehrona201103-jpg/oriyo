"""Run: python -m app.core.init_owner"""
from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password
from app.core.config import settings
from app.models.user import User, Role


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.role == Role.owner).first()
        if existing:
            print(f"Owner already exists: {existing.email}")
            return
        owner = User(
            email=settings.FIRST_OWNER_EMAIL,
            hashed_password=hash_password(settings.FIRST_OWNER_PASSWORD),
            full_name="ORIYO Owner",
            role=Role.owner,
            is_active=True,
        )
        db.add(owner)
        db.commit()
        print(f"Owner created successfully: {settings.FIRST_OWNER_EMAIL}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
