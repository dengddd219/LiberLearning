// frontend/src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { TabsProvider } from './context/TabsContext'
import TopBar from './components/TopBar'
import LobbyPage from './pages/LobbyPage'
import SessionPage from './pages/SessionPage'
import UploadPage from './pages/UploadPage'
import ProcessingPage from './pages/ProcessingPage'
import NotesPage from './pages/NotesPage'
import DetailedNotePage from './pages/DetailedNotePage'

function App() {
  return (
    <TabsProvider>
      <TopBar />
      <Routes>
        <Route path="/"                        element={<LobbyPage />} />
        <Route path="/session"                 element={<SessionPage />} />
        <Route path="/session/live"            element={<Navigate to="/session" replace />} />
        <Route path="/upload"                  element={<UploadPage />} />
        <Route path="/processing"              element={<ProcessingPage />} />
        <Route path="/notes/:sessionId"        element={<NotesPage />} />
        <Route path="/notes/detail/:sessionId" element={<DetailedNotePage />} />
        <Route path="*"                        element={<Navigate to="/" replace />} />
      </Routes>
    </TabsProvider>
  )
}

export default App
