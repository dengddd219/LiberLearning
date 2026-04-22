// frontend/src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { TabsProvider } from './context/TabsContext'
import { TranslationProvider } from './context/TranslationContext'
import TopBar from './components/TopBar'
import LobbyPage from './pages/LobbyPage'
import LivePage from './pages/LivePage'
import NotesPage from './pages/NotesPage'
import DetailedNotePage from './pages/DetailedNotePage'
import DiagnosticsPage from './pages/DiagnosticsPage'

function App() {
  return (
    <TranslationProvider>
      <TabsProvider>
        <TopBar />
        <Routes>
          <Route path="/"                        element={<LobbyPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/notes/new"              element={<NotesPage />} />
          <Route path="/notes/:sessionId"        element={<NotesPage />} />
          <Route path="/notes/detail/:sessionId" element={<DetailedNotePage />} />
          <Route path="/diagnostics"             element={<DiagnosticsPage />} />
          <Route path="*"                        element={<Navigate to="/" replace />} />
        </Routes>
      </TabsProvider>
    </TranslationProvider>
  )
}

export default App
