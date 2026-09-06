import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'

// Шрифты кладутся в сборку, а не тянутся из сети: цех работает в
// локальной сети без интернета, и внешний CDN там просто не ответит.
import '@fontsource/ibm-plex-sans/cyrillic-400.css'
import '@fontsource/ibm-plex-sans/cyrillic-500.css'
import '@fontsource/ibm-plex-sans/cyrillic-600.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/cyrillic-400.css'
import '@fontsource/ibm-plex-mono/cyrillic-500.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'

import App from './App'
import { IS_DEMO } from './api/demo'
import './styles.css'

// Файл, брошенный мимо рабочего поля, браузер открывает вместо платформы —
// и несохранённая раскладка пропадает. Промах обязан быть безвредным.
for (const event of ['dragover', 'drop'] as const) {
  window.addEventListener(event, (native) => {
    const target = native.target as HTMLElement | null
    if (target?.closest('[data-drop]')) return
    native.preventDefault()
  })
}

// Демо открывают как один файл — там нет сервера, который отдаст /editor по
// прямой ссылке, поэтому маршруты живут в адресе после решётки.
const Router = IS_DEMO ? HashRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
)
