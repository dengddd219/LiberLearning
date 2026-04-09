import { Routes, Route, Navigate } from 'react-router-dom'
import SessionPage from './pages/SessionPage'
import UploadPage from './pages/UploadPage'
import ProcessingPage from './pages/ProcessingPage'
import NotesPage from './pages/NotesPage'

function App() {
  return (
    <Routes>
      <Route path="/session" element={<SessionPage />} />
      <Route path="/upload" element={<UploadPage />} />
      <Route path="/processing" element={<ProcessingPage />} />
      <Route path="/notes/:sessionId" element={<NotesPage />} />
      <Route path="*" element={<Navigate to="/session" replace />} />
    </Routes>
  )
}

export default App
