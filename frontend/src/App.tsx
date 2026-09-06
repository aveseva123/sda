import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import ImportPage from './pages/ImportPage'
import MaterialsPage from './pages/MaterialsPage'
import PartsPage from './pages/PartsPage'
import PendingPage from './pages/PendingPage'
import ProjectsPage from './pages/ProjectsPage'
import StockPage from './pages/StockPage'
import { usePendingCount } from './lib/hooks'

export default function App() {
  const pending = usePendingCount()

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>
          Раскрой
          <small>Этап 1 — импорт и сортировка</small>
        </h1>
        <NavLink className="nav-link" to="/import">
          Импорт DXF
        </NavLink>
        <NavLink className="nav-link" to="/projects">
          Проекты
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
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/pending" element={<PendingPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/stock" element={<StockPage />} />
        </Routes>
      </main>
    </div>
  )
}
