import { Routes, Route, Link, useNavigate, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect, createContext, useContext, useCallback, useMemo } from 'react'
import api, { User } from './services/api'
import { hasBiometricRegistered, verifyBiometric } from './services/biometric'
import { IconHome, IconUser, IconCart, IconAdmin, IconLogout, IconLock, IconFingerprint, IconSearch, IconPackage } from './components/Icons'
import HomePage from './pages/HomePage'
import ProductPage from './pages/ProductPage'
import CartPage from './pages/CartPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import OrdersPage from './pages/OrdersPage'
import OrderDetailPage from './pages/OrderDetailPage'
import AdminPage from './pages/AdminPage'
import ProfilePage from './pages/ProfilePage'
import { I18nProvider, useI18n } from './i18n'
import PolicyPage from './pages/PolicyPage'

interface AuthCtx {
  user: User | null
  setUser: (u: User | null) => void
  logout: () => void
}

const AuthContext = createContext<AuthCtx>({ user: null, setUser: () => {}, logout: () => {} })
export const useAuth = () => useContext(AuthContext)

function isStaff(u: User | null) {
  return !!u && (u.role === 'owner' || u.role === 'admin')
}

function applyDevice(device?: string) {
  document.body.classList.remove('device-phone', 'device-tablet', 'device-pc')
  const d = device || localStorage.getItem('oriyo_device') || 'phone'
  document.body.classList.add(`device-${d}`)
  localStorage.setItem('oriyo_device', d)
}

function CustomerHeader() {
  const { user, logout } = useAuth()
  const { t, toggle, lang } = useI18n()
  const [supportUrl, setSupportUrl] = useState('')
  const [dark, setDark] = useState(() => localStorage.getItem('oriyo_theme') === 'dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('oriyo_theme', dark ? 'dark' : 'light')
  }, [dark])
  useEffect(() => {
    api.get('/orders/settings/public').then((r) => {
      setSupportUrl(r.data.telegram_admin_dm || r.data.telegram_channel_url || '')
    }).catch(() => {})
  }, [])
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="logo logo-brand">
          <img src="/icon-192.png" alt="" className="logo-mark" />
          <span className="logo-text">ORI<span>YO</span></span>
        </Link>
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); navigate(`/?q=${encodeURIComponent(q)}`) }}>
          <input type="search" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
          <button type="submit" aria-label="Поиск"><IconSearch size={18} /></button>
        </form>
        <div className="nav-actions nav-desktop">
          <button type="button" className="theme-btn" onClick={() => setDark((d) => !d)} title="Тема">{dark ? '☀️' : '🌙'}</button>
          <button type="button" className="theme-btn" onClick={toggle} title="Язык">{lang === 'ru' ? 'TJ' : 'RU'}</button>
          {user ? (
            <>
              <Link to="/profile"><IconUser size={16} /> Профиль</Link>
              <Link to="/cart"><IconCart size={16} /> Корзина</Link>
              <button onClick={logout}><IconLogout size={16} /></button>
            </>
          ) : (
            <>
              <Link to="/login">Вход</Link>
              <Link to="/register" className="btn-primary">Регистрация</Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

function AdminHeader() {
  const { logout } = useAuth()
  return (
    <header className="header admin-header">
      <div className="container header-inner">
        <Link to="/admin" className="logo logo-brand">
          <img src="/icon-192.png" alt="" className="logo-mark" />
          <span className="logo-text">ORI<span>YO</span></span>
          <small className="admin-tag">Админ</small>
        </Link>
        <div className="nav-actions">
          <button onClick={logout}><IconLogout size={16} /> Выход</button>
        </div>
      </div>
    </header>
  )
}

function SupportFab() {
  const [url, setUrl] = useState('')
  const [fly, setFly] = useState(false)
  useEffect(() => {
    api.get('/orders/settings/public').then((r) => {
      setUrl(r.data.telegram_admin_dm || r.data.telegram_channel_url || 'https://t.me/oriyosupport_bot')
    }).catch(() => setUrl('https://t.me/oriyosupport_bot'))
  }, [])
  useEffect(() => {
    // ~5 flights per day ≈ every ~3 hours, first after 40s
    const key = 'oriyo_tg_flights'
    const day = new Date().toDateString()
    const run = () => {
      try {
        const raw = JSON.parse(localStorage.getItem(key) || '{}')
        if (raw.day !== day) { raw.day = day; raw.n = 0 }
        if (raw.n >= 5) return
        raw.n += 1
        localStorage.setItem(key, JSON.stringify(raw))
        setFly(true)
        setTimeout(() => setFly(false), 6000)
      } catch {}
    }
    const first = setTimeout(run, 40000)
    const id = setInterval(run, 3 * 60 * 60 * 1000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [])
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`support-fab ${fly ? 'fly' : ''}`} title="Telegram">
      <span className="tg-plane">✈</span>
    </a>
  )
}

function BottomNav() {
  const { user } = useAuth()
  const loc = useLocation()
  const navigate = useNavigate()
  const on = (path: string) => loc.pathname === path || (path !== '/' && loc.pathname.startsWith(path))
  const onVisual = (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    api.post('/products/visual-search', fd).then((r) => {
      const items = r.data?.items || []
      if (items[0]) navigate(`/product/${items[0].id}`)
      else alert(r.data?.hint || 'Ничего не найдено')
    }).catch(() => alert('Поиск по фото не удался'))
  }
  return (
    <nav className="bottom-nav">
      <Link to="/" className={on('/') && !on('/product') ? 'active' : ''}><IconHome size={22} /><span>Главная</span></Link>
      <Link to="/cart" className={on('/cart') ? 'active' : ''}><IconCart size={22} /><span>Корзина</span></Link>
      <label className="nav-cam">
        <IconSearch size={22} />
        <span>Фото</span>
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onVisual(f)
        }} />
      </label>
      <Link to="/orders" className={on('/orders') ? 'active' : ''}><IconPackage size={22} /><span>Заказы</span></Link>
      <Link to={user ? '/profile' : '/login'} className={on('/profile') || on('/login') ? 'active' : ''}><IconUser size={22} /><span>Профиль</span></Link>
    </nav>
  )
}

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const dur = 1200
    let raf = 0
    const tick = () => {
      const p = Math.min(100, Math.round(((Date.now() - start) / dur) * 100))
      setPct(p)
      if (p >= 100) setTimeout(onDone, 150)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [onDone])
  return (
    <div className="splash-screen">
      <div className="splash-logo">ORIYO</div>
      <div className="splash-track">
        <div className="splash-bar" style={{ width: pct + '%' }} />
        <div className="splash-truck" style={{ left: `calc(${pct}% - 18px)`, transform: 'scaleX(-1)' }}>🚚</div>
      </div>
      <div className="splash-pct">{pct}%</div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const needsLock = !!(localStorage.getItem('oriyo_pin') || hasBiometricRegistered())
  const [unlocked, setUnlocked] = useState(!needsLock)
  const [splashDone, setSplashDone] = useState(() => sessionStorage.getItem('oriyo_splash') === '1')
  const [broadcast, setBroadcast] = useState<{ id: number; text: string } | null>(null)
  const [pinTry, setPinTry] = useState('')
  const [pinError, setPinError] = useState('')
  const [bioLoading, setBioLoading] = useState(false)

  useEffect(() => {
    applyDevice()
    document.documentElement.style.touchAction = 'manipulation'
    const token = localStorage.getItem('oriyo_token')
    if (token) {
      api.get('/auth/me')
        .then((r) => {
          setUser(r.data)
          applyDevice(r.data.device_type)
        })
        .catch(() => localStorage.removeItem('oriyo_token'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!unlocked && hasBiometricRegistered()) {
      setBioLoading(true)
      verifyBiometric()
        .then((ok) => { if (ok) setUnlocked(true) })
        .finally(() => setBioLoading(false))
    }
  }, [unlocked])

  const logout = useCallback(() => {
    localStorage.removeItem('oriyo_token')
    setUser(null)
  }, [])

  const authValue = useMemo(() => ({ user, setUser, logout }), [user, logout])
  const staff = isStaff(user)

  useEffect(() => {
    if (staff) return
    const poll = () => {
      api.get('/orders/settings/public').then((r) => {
        const raw = r.data?.live_broadcast
        if (!raw) return
        try {
          const b = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (!b?.id || !b?.text) return
          const seen = localStorage.getItem('oriyo_bc_seen')
          if (seen === String(b.id)) return
          setBroadcast({ id: b.id, text: b.text })
        } catch {}
      }).catch(() => {})
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => clearInterval(id)
  }, [staff])

  if (!splashDone) {
    return <SplashScreen onDone={() => { sessionStorage.setItem('oriyo_splash', '1'); setSplashDone(true) }} />
  }

  if (loading) {
    return <div className="boot-screen"><div className="boot-logo">ORIYO</div><div className="boot-spin" /></div>
  }

  if (!unlocked) {
    return (
      <div className="lock-screen">
        <div className="lock-card">
          <div className="lock-icon"><IconLock size={36} /></div>
          <h1>ORIYO</h1>
          <p className="hint">Разблокируйте приложение</p>
          {hasBiometricRegistered() && (
            <button className="btn-accent" disabled={bioLoading} onClick={async () => {
              setBioLoading(true)
              const ok = await verifyBiometric()
              setBioLoading(false)
              if (ok) setUnlocked(true)
              else setPinError('Биометрия не подтверждена')
            }}>
              <IconFingerprint size={18} /> {bioLoading ? 'Проверка…' : 'Face ID / Touch ID'}
            </button>
          )}
          {localStorage.getItem('oriyo_pin') && (
            <>
              <input type="password" inputMode="numeric" maxLength={4} value={pinTry}
                placeholder="PIN" autoComplete="one-time-code"
                onChange={(e) => setPinTry(e.target.value.replace(/\D/g, ''))}
                className="pin-input" />
              {pinError && <p className="error">{pinError}</p>}
              <button className="btn-accent" onClick={() => {
                if (pinTry === localStorage.getItem('oriyo_pin')) setUnlocked(true)
                else { setPinError('Неверный PIN'); setPinTry('') }
              }}>Разблокировать</button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ========== ADMIN-ONLY SHELL ==========
  if (staff) {
    return (
      <AuthContext.Provider value={authValue}>
        <AdminHeader />
        <main className="container page-bottom-admin">
          <Routes>
            <Route path="/admin/*" element={<AdminPage />} />
            <Route path="/login" element={<Navigate to="/admin" replace />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </AuthContext.Provider>
    )
  }

  // ========== CUSTOMER APP ==========
  return (
    <AuthContext.Provider value={authValue}>
      <CustomerHeader />
      <main className="container page-bottom">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/product/:id" element={<ProductPage />} />
          <Route path="/cart" element={user ? <CartPage /> : <Navigate to="/login" />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/orders" element={user ? <OrdersPage /> : <Navigate to="/login" />} />
          <Route path="/policy" element={<PolicyPage />} />
          <Route path="/orders/:id" element={user ? <OrderDetailPage /> : <Navigate to="/login" />} />
          <Route path="/profile" element={user ? <ProfilePage /> : <Navigate to="/login" />} />
          <Route path="/admin/*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {broadcast && (
        <div className="broadcast-modal">
          <div className="broadcast-card">
            <h3>Сообщение ORIYO</h3>
            <p>{broadcast.text}</p>
            <button type="button" className="btn-accent" onClick={() => {
              localStorage.setItem('oriyo_bc_seen', String(broadcast.id))
              setBroadcast(null)
            }}>Закрыть</button>
          </div>
        </div>
      )}
      <SupportFab />
      <BottomNav />
      <footer>
        <div className="container"><strong>ORIYO</strong> — товары из Китая · Таджикистан</div>
      </footer>
    </AuthContext.Provider>
  )
}
