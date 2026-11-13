import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Barlow and Barlow Condensed, bundled by Vite into /assets, so the CSP can
// keep allowing only 'self': no font comes from another origin.
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
