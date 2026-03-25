import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { CapturePage } from './pages/CapturePage'
import { ExportPage } from './pages/ExportPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { useSessionStore } from './store/session-store'

export default function App() {
  const initialize = useSessionStore((state) => state.initialize)
  const isReady = useSessionStore((state) => state.isReady)

  useEffect(() => {
    void initialize()
  }, [initialize])

  if (!isReady) {
    return <div className="boot-screen">Loading workspace...</div>
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<CapturePage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
