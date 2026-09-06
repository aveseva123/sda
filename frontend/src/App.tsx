import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import EditorPage from './pages/EditorPage'
import ImportPage from './pages/ImportPage'
import MaterialsPage from './pages/MaterialsPage'
import PartsPage from './pages/PartsPage'
import PendingPage from './pages/PendingPage'
import FilesPage from './pages/FilesPage'
import StockPage from './pages/StockPage'
import { usePendingCount } from './lib/hooks'

export default function App() {
  const pending = usePendingCount()

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>
          Раскрой
          <small>Импорт · раскладка · траектории</small>
        </h1>
        <NavLink className="nav-link" to="/import">
          Импорт DXF
        </NavLink>
        <NavLink className="nav-link" to="/editor">
          Редактор раскроя
        </NavLink>
        <NavLink className="nav-link" to="/files">
          Файлы и заказы
        </NavLink>
        <NavLink className="nav-link" to="/parts">
          Детали
        </NavLink>
        <NavLink className="nav-link" to="/pending">
          <span>Требуют уточнения</span>
          {pending > 0 && <span className="badge warn">{pending}</span>}
        </NavLink>
        <NavLink className="nav-link" to="/materials">
          Материалы
        </NavLink>
        <NavLink className="nav-link" to="/stock">
          Склад
        </NavLink>
      </nav>
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
