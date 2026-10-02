import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App'

// Clickjacking guard: CSP frame-ancestors cannot be set via a <meta> tag on GitHub Pages,
// so refuse to render inside a frame.
const framed = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

if (framed) {
  document.body.textContent = 'HavenWear Ops cannot be displayed inside another site.'
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
