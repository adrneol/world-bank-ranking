import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { viewAtPath } from './config/publicPages.js'

if (viewAtPath(window.location.pathname) !== 'public-data') {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
else if (!document.getElementById('root').querySelector('[data-public-view="public-data"]')) {
  // A misconfigured static host must still show an intentional state.
  createRoot(document.getElementById('root')).render(
    <main className="public-document"><h1>Public API documentation unavailable</h1>
      <p>This route needs the publication-aware document handler. <a href="/">Return Home</a>.</p></main>,
  )
}
