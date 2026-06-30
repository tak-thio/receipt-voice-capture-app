// Separate entry point for the platform operator (運営) console. Built as its
// own page (operator.html) so it is served as a real static file — no SPA
// history fallback. Completely isolated from the tenant app (App.tsx).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OperatorConsole } from './views/Operator'
import { ToastProvider } from './ui/toast'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <OperatorConsole />
    </ToastProvider>
  </StrictMode>,
)
