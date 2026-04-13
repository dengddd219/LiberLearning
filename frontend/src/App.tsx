import { Routes, Route, Navigate } from 'react-router-dom'
import LobbyPage from './pages/LobbyPage'
import SessionPage from './pages/SessionPage'
import UploadPage from './pages/UploadPage'
import ProcessingPage from './pages/ProcessingPage'
import NotesPage from './pages/NotesPage'
import DetailedNotePage from './pages/DetailedNotePage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LobbyPage />} />
      <Route path="/session" element={<SessionPage />} />
      <Route path="/upload" element={<UploadPage />} />
      <Route path="/processing" element={<ProcessingPage />} />
      <Route path="/notes/:sessionId" element={<NotesPage />} />
      <Route path="/notes/detail/:sessionId" element={<DetailedNotePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
