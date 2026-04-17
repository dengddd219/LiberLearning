// 纯布局壳：复用 NotesPage 真实色彩和结构，无任何 hook/副作用
const C = {
  bg: '#F7F7F2',
  sidebar: '#F2F2EC',
  fg: '#292929',
  secondary: '#72726E',
  muted: '#D0CFC5',
  divider: '#E3E3DA',
}

export default function NotesBgShell() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, fontFamily: "Inter, 'PingFang SC', sans-serif", overflow: 'hidden' }}>

      {/* TopAppBar */}
      <div style={{ height: '40px', background: C.sidebar, borderBottom: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', flexShrink: 0 }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: C.divider }} />
        <div style={{ width: '120px', height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.6 }} />
        <div style={{ flex: 1 }} />
        <div style={{ width: '60px', height: '22px', borderRadius: '99px', background: C.divider }} />
        <div style={{ width: '60px', height: '22px', borderRadius: '99px', background: C.divider }} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Slide nav (hidden, navVisible=false by default) — show a thin strip */}
        <div style={{ width: '0px' }} />

        {/* Canvas area */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: '40px 48px', overflow: 'hidden' }}>
          <div style={{ width: '100%', maxWidth: '640px', aspectRatio: '16/9', background: C.sidebar, borderRadius: '8px', border: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '70%' }}>
              <div style={{ height: '14px', borderRadius: '99px', background: C.muted, opacity: 0.5, width: '60%' }} />
              <div style={{ height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.3, width: '85%' }} />
              <div style={{ height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.3, width: '70%' }} />
            </div>
          </div>
        </div>

        {/* Resizer */}
        <div style={{ width: '4px', background: C.divider, flexShrink: 0 }} />

        {/* Notes panel */}
        <div style={{ width: '440px', background: C.bg, borderLeft: `1px solid ${C.divider}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          {/* Panel header */}
          <div style={{ height: '48px', borderBottom: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: '8px', flexShrink: 0 }}>
            <div style={{ width: '64px', height: '22px', borderRadius: '99px', background: '#798C00', opacity: 0.15 }} />
            <div style={{ width: '64px', height: '22px', borderRadius: '99px', background: C.divider }} />
          </div>
          {/* Note content */}
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden' }}>
            {[90, 75, 85, 60, 80, 55, 70, 45, 65, 80].map((w, i) => (
              <div key={i} style={{ height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.45, width: `${w}%` }} />
            ))}
            <div style={{ height: '1px', background: C.divider, margin: '4px 0' }} />
            {[70, 55, 88, 65].map((w, i) => (
              <div key={i} style={{ height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.3, width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
