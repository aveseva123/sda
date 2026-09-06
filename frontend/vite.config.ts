import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Демо-сборка (`npm run build:demo`) собирает интерфейс в один HTML-файл со
// снимком данных внутри: его можно открыть двойным кликом, без сервера.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  // Признак демо-сборки задаётся здесь, а не в .env: файла с переменными в
  // репозитории нет, и без него демо молча собиралось обычным — с
  // BrowserRouter и запросами к серверу, которого рядом нет. Открытый двойным
  // кликом файл показывал пустой экран.
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify(mode === 'demo' ? '1' : '0') },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: mode === 'demo' ? { outDir: 'dist-demo', assetsInlineLimit: 10_000_000 } : {},
}))
