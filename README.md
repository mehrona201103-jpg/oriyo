# ORIYO — Marketplace for goods from China to Tajikistan

**ORIYO** is a modern full-stack marketplace platform for ordering products from China with delivery across Tajikistan.

- **Brand**: ORIYO
- **Currency**: TJS (Somoni)
- **Languages**: Russian (primary), Tajik, English
- **Stack**: FastAPI + React + TypeScript + PostgreSQL + Vite

## Features (Core Implemented)

- User registration / login (JWT)
- Product catalog with categories, search, filters
- Product variants, images, stock
- Shopping cart
- Order creation with server-side price calculation
- Manual payment with receipt upload
- Admin panel for products, orders, payment review, delivery zones
- Delivery zones & rates by city/district
- Order statuses & tracking history
- Multi-language support (i18n ready)
- Role-based access (owner, admin, support, customer)
- Docker + Railway ready

## Project Structure

```
ORIYO/
├── backend/
│   ├── app/
│   │   ├── api/          # API routers
│   │   ├── core/         # Config, security, database
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # Business logic
│   │   └── repositories/ # Data access
│   ├── alembic/          # Migrations
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── layouts/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── locales/
│   │   └── types/
│   └── package.json
├── Dockerfile
├── railway.toml
├── .env.example
├── .gitignore
└── README.md
```

## Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL (or use SQLite for quick local test)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env
# Edit .env with your DATABASE_URL and SECRET_KEY

# Run migrations
alembic upgrade head

# Create first owner
python -m app.core.init_owner

# Start
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Railway Deployment (24/7)

1. Create a new project on Railway
2. Add **PostgreSQL** service
3. Create a new service from GitHub repo (or Dockerfile)
4. Set environment variables (see below)
5. Deploy

### Required Environment Variables

```
DATABASE_URL=postgresql://...          # from Railway PostgreSQL
SECRET_KEY=your-long-random-secret
FIRST_OWNER_EMAIL=owner@oriyo.tj
FIRST_OWNER_PASSWORD=strong-password-here
PORT=8000                              # Railway provides this
CORS_ORIGINS=https://your-app.up.railway.app
ENVIRONMENT=production
```

### Dockerfile builds both frontend + backend

The provided Dockerfile:
- Builds React frontend
- Serves static files via FastAPI
- Runs Uvicorn on $PORT

## Creating First Owner

```bash
# Locally or in Railway shell
python -m app.core.init_owner
```

Or set `FIRST_OWNER_EMAIL` and `FIRST_OWNER_PASSWORD` — the app will create the owner on first startup if no owner exists.

## Admin Panel

After login as owner → go to `/admin`

You can:
- Manage products & categories
- Review payment receipts
- Configure payment methods (card number, phone, instructions)
- Set delivery zones and rates by city
- Change order statuses
- Manage users

## Payment Flow

1. Customer places order → status `awaiting_payment`
2. Sees current payment details (editable in Admin → Payment Methods)
3. Transfers money manually
4. Uploads receipt photo/screenshot
5. Status → `payment_review`
6. Admin confirms → `paid` or rejects with reason
7. Order proceeds through delivery statuses

## Delivery Zones

Admin → Delivery Zones:
- Create zones (city / district)
- Set base price, free shipping threshold, estimated days
- Orders calculate delivery server-side based on selected address

## Known Limitations / Next Steps

- Email/SMS notifications require external service (not included)
- Real supplier APIs (1688, etc.) not connected — products added manually
- Group buying & full loyalty program are scaffolded but disabled by default
- AI recommendations ready for future integration (no paid API required)
- File uploads stored on local disk (for production consider S3-compatible storage)
- No Redis/Celery — all runs in single process (suitable for Railway free/hobby)

## License

Proprietary — ORIYO project.
