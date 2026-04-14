// frontend/src/context/TabsContext.tsx
import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

export interface CourseTab {
  sessionId: string
  label: string          // 显示在 tab 上的名字，如 "7028" 或课程名
}

interface TabsState {
  tabs: CourseTab[]
  activeTabId: string | null
  openTab: (tab: CourseTab) => void
  closeTab: (sessionId: string) => void
  activateTab: (sessionId: string) => void
}

const TabsContext = createContext<TabsState | null>(null)

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<CourseTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const openTab = useCallback((tab: CourseTab) => {
    setTabs((prev) => {
      if (prev.find((t) => t.sessionId === tab.sessionId)) return prev
      return [...prev, tab]
    })
    setActiveTabId(tab.sessionId)
  }, [])

  const closeTab = useCallback((sessionId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.sessionId !== sessionId)
      setActiveTabId((currentActive) => {
        if (currentActive !== sessionId) return currentActive
        const idx = prev.findIndex((t) => t.sessionId === sessionId)
        return next[Math.max(0, idx - 1)]?.sessionId ?? null
      })
      return next
    })
  }, [])

  const activateTab = useCallback((sessionId: string) => {
    setActiveTabId(sessionId)
  }, [])

  return (
    <TabsContext.Provider value={{ tabs, activeTabId, openTab, closeTab, activateTab }}>
      {children}
    </TabsContext.Provider>
  )
}

export function useTabs() {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within TabsProvider')
  return ctx
}
