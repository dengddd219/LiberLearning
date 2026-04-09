import { useState, useEffect, type ReactNode } from 'react'

interface ThreeColumnLayoutProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
  leftCollapsed?: boolean
}

export default function ThreeColumnLayout({
  left,
  center,
  right,
  leftCollapsed: externalCollapsed = false,
}: ThreeColumnLayoutProps) {
  // Auto-collapse left column on narrow viewports (< 1024px)
  const [autoCollapsed, setAutoCollapsed] = useState(window.innerWidth < 1024)

  useEffect(() => {
    const handler = () => setAutoCollapsed(window.innerWidth < 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const collapsed = externalCollapsed || autoCollapsed

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 min-w-0">
      {/* Left column — outline nav, collapsible */}
      <div
        className={`flex-none bg-white border-r border-gray-200 transition-all duration-200 overflow-y-auto ${
          collapsed ? 'w-0 overflow-hidden' : 'w-48'
        }`}
      >
        {left}
      </div>

      {/* Center column — PPT canvas, flex-grow */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {center}
      </div>

      {/* Right column — notes / recording controls, fixed width */}
      <div className="flex-none w-80 bg-white border-l border-gray-200 overflow-y-auto flex flex-col">
        {right}
      </div>
    </div>
  )
}
