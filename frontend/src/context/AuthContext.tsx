import { createContext, useContext, useEffect, useState } from 'react'
import { getCurrentUser, logout as apiLogout, type AuthUser } from '../lib/api'

type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  refreshUser: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshUser() {
    try {
      const nextUser = await getCurrentUser()
      setUser(nextUser)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    await apiLogout()
    setUser(null)
  }

  useEffect(() => {
    void refreshUser()
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
