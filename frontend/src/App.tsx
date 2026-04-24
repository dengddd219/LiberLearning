// frontend/src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { TabsProvider } from './context/TabsContext'
import { TranslationProvider } from './context/TranslationContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import TopBar from './components/TopBar'
import LobbyPage from './pages/LobbyPage'
import LivePage from './pages/LivePage'
import NotesPage from './pages/NotesPage'
import DetailedNotePage from './pages/DetailedNotePage'
import DiagnosticsPage from './pages/DiagnosticsPage'
import LoginPage from './pages/LoginPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F5F3EC',
          color: '#72726E',
          fontSize: '14px',
        }}
      >
        正在检查登录状态...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <TranslationProvider>
        <TabsProvider>
          <TopBar />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<PrivateRoute><LobbyPage /></PrivateRoute>} />
            <Route path="/live" element={<PrivateRoute><LivePage /></PrivateRoute>} />
            <Route path="/notes/new" element={<PrivateRoute><NotesPage /></PrivateRoute>} />
            <Route path="/notes/:sessionId" element={<PrivateRoute><NotesPage /></PrivateRoute>} />
            <Route path="/notes/detail/:sessionId" element={<PrivateRoute><DetailedNotePage /></PrivateRoute>} />
            <Route path="/diagnostics" element={<PrivateRoute><DiagnosticsPage /></PrivateRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TabsProvider>
      </TranslationProvider>
    </AuthProvider>
  )
}

export default App
