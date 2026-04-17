// 纯布局壳：复用 LivePage 真实色彩和结构，无任何 hook/副作用
const C = {
  bg: '#F7F7F2',
  sidebar: '#F2F2EC',
  fg: '#292929',
  secondary: '#72726E',
  muted: '#D0CFC5',
  divider: '#E3E3DA',
}

export default function LiveBgShell() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, fontFamily: "Inter, 'PingFang SC', sans-serif", overflow: 'hidden' }}>

      {/* TopAppBar */}
      <div style={{ height: '40px', background: C.sidebar, borderBottom: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', flexShrink: 0 }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: C.divider }} />
        <div style={{ width: '90px', height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.6 }} />
        <div style={{ flex: 1 }} />
        {/* REC indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '99px', background: 'rgba(224,92,64,0.1)' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E05C40' }} />
          <div style={{ width: '28px', height: '8px', borderRadius: '99px', background: '#E05C40', opacity: 0.6 }} />
        </div>
        <div style={{ width: '60px', height: '22px', borderRadius: '99px', background: C.divider }} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Canvas area — full width (no notes panel in live) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 48px' }}>
            <div style={{ width: '100%', maxWidth: '720px', aspectRatio: '16/9', background: C.sidebar, borderRadius: '8px', border: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '65%' }}>
                <div style={{ height: '14px', borderRadius: '99px', background: C.muted, opacity: 0.5, width: '55%' }} />
                <div style={{ height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.3, width: '80%' }} />
                <div style={{ height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.3, width: '65%' }} />
              </div>
            </div>
          </div>

          {/* Subtitle bar */}
          <div style={{ height: '56px', background: C.sidebar, borderTop: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', padding: '0 32px', gap: '12px', flexShrink: 0 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#798C00' }} />
            <div style={{ width: '52%', height: '10px', borderRadius: '99px', background: C.muted, opacity: 0.5 }} />
          </div>
        </div>

        {/* Right panel: live transcript */}
        <div style={{ width: '300px', background: C.sidebar, borderLeft: `1px solid ${C.divider}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ height: '40px', borderBottom: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: '6px', flexShrink: 0 }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#E05C40', opacity: 0.7 }} />
            <div style={{ width: '60px', height: '9px', borderRadius: '99px', background: C.muted, opacity: 0.5 }} />
          </div>
          <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>
            {[85, 60, 90, 70, 50, 80, 65, 55, 75, 40, 68].map((w, i) => (
              <div key={i} style={{ height: '9px', borderRadius: '99px', background: C.muted, opacity: 0.35, width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
