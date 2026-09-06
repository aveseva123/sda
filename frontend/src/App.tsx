import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import EditorPage from './pages/EditorPage'
import ImportPage from './pages/ImportPage'
import MaterialsPage from './pages/MaterialsPage'
import PresetsPage from './pages/PresetsPage'
import FilesPage from './pages/FilesPage'
import StockPage from './pages/StockPage'
import { IS_DEMO } from './api/demo'

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
  materials: <path d="M2.5 5.5 8 2.5l5.5 3-5.5 3zM2.5 8.5 8 11.5l5.5-3" />,
  presets: <path d="M8 2.5v6M5.5 8.5h5l-1 5h-3zM6.5 2.5h3" />,
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
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>
          <Mark />
          Нестор
        </h1>
        <nav>
          <NavItem to="/editor" icon="editor">
            Раскрой
          </NavItem>
          <NavItem to="/import" icon="import">
            Импорт DXF
          </NavItem>
          <NavItem to="/files" icon="files">
            Файлы и проекты
          </NavItem>
          <NavItem to="/presets" icon="presets">
            Шаблоны траекторий
          </NavItem>
          <NavItem to="/materials" icon="materials">
            Материалы
          </NavItem>
          <NavItem to="/stock" icon="stock">
            Склад
          </NavItem>
        </nav>
        <div className="sidebar-foot">
          {IS_DEMO ? (
            <>
              <b style={{ color: 'var(--warn)' }}>Демонстрация интерфейса</b>
              <br />
              данные настоящие, но заморожены: раскрой не пересчитывается,
              импорт и склад недоступны
            </>
          ) : (
            <>
              Локальная сеть цеха
              <br />
              без входа и учётных записей
            </>
          )}
        </div>
      </aside>
      <main className="main">
        <Routes>
          {/* Работа начинается с раскроя: файлы добавляются в него, а не наоборот. */}
          <Route path="/" element={<Navigate to="/editor" replace />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/files" element={<FilesPage />} />
          {/* Библиотека фрез живёт внутри шаблонов траекторий. */}
          <Route path="/tools" element={<Navigate to="/presets" replace />} />
          <Route path="/parts" element={<Navigate to="/editor" replace />} />
          <Route path="/pending" element={<Navigate to="/editor" replace />} />
          <Route path="/presets" element={<PresetsPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/stock" element={<StockPage />} />
        </Routes>
      </main>
    </div>
  )
}
