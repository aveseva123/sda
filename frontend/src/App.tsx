import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import EditorPage from './pages/EditorPage'
import ImportPage from './pages/ImportPage'
import MaterialsPage from './pages/MaterialsPage'
import PartsPage from './pages/PartsPage'
import PendingPage from './pages/PendingPage'
import FilesPage from './pages/FilesPage'
import StockPage from './pages/StockPage'
import { usePendingCount } from './lib/hooks'

/** Логотип: лист с вырезанной деталью — то, чем платформа занимается. */
function Mark() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="#E8EAED" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="17" height="17" rx="2.5" />
      <path d="M1.5 8h17M8 1.5v17M8 13h5.5v5.5" />
    </svg>
  )
}

const ICONS: Record<string, JSX.Element> = {
  import: <path d="M8 2v8M5 7l3 3 3-3M2.5 12v1.5h11V12" />,
  editor: <path d="M2 2.5h12v11H2zM2 8.5h6.5M8.5 2.5v11M8.5 8.5H14" />,
  files: <path d="M2 4.5h4.5L8 6h6v7.5H2z" />,
  parts: <path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3z" />,
  pending: <path d="M8 2.5 14.5 13.5h-13zM8 6.5v3M8 11.4v.2" />,
  materials: <path d="M2.5 5.5 8 2.5l5.5 3-5.5 3zM2.5 8.5 8 11.5l5.5-3" />,
  stock: <path d="M2.5 13.5 13.5 2.5M2.5 8.5v5h5" />,
}

function NavItem({ to, icon, children }: { to: string; icon: string; children: React.ReactNode }) {
  return (
    <NavLink className="nav-link" to={to}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        {ICONS[icon]}
      </svg>
      {children}
    </NavLink>
  )
}

export default function App() {
  const pending = usePendingCount()

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>
          <Mark />
          Нестор
        </h1>
        <nav>
          <NavItem to="/import" icon="import">
            Импорт DXF
          </NavItem>
          <NavItem to="/editor" icon="editor">
            Раскрой
          </NavItem>
          <NavItem to="/files" icon="files">
            Файлы и заказы
          </NavItem>
          <NavItem to="/parts" icon="parts">
            Детали
          </NavItem>
          <NavItem to="/pending" icon="pending">
            <span>Требуют уточнения</span>
            {pending > 0 && <span className="badge warn">{pending}</span>}
          </NavItem>
          <NavItem to="/materials" icon="materials">
            Материалы
          </NavItem>
          <NavItem to="/stock" icon="stock">
            Остатки
          </NavItem>
        </nav>
        <div className="sidebar-foot">
          Локальная сеть цеха
          <br />
          без входа и учётных записей
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/import" replace />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/pending" element={<PendingPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/stock" element={<StockPage />} />
        </Routes>
      </main>
    </div>
  )
}
