import { useNavigate } from 'react-router-dom'

const COURSES = [
  { id: 'msba7028', name: 'MSBA 7028', active: true },
  { id: 'ba-intro', name: '商业分析导论', active: false },
  { id: 'ds',       name: '数据结构',    active: false },
  { id: 'econ',     name: '经济学原理',  active: false },
]

type SessionStatus = 'done' | 'loading'

interface SessionCard {
  id: string
  title: string
  duration: string
  notes: string
  date: string
  status: SessionStatus
}

const SESSIONS: SessionCard[] = [
  { id: 's1', title: 'MSBA 7028 第3讲', duration: '1小时 12分', notes: '18页笔记', date: '2026-04-12', status: 'done' },
  { id: 's2', title: 'MSBA 7028 第2讲', duration: '1小时 05分', notes: '15页笔记', date: '2026-04-10', status: 'done' },
  { id: 's3', title: 'MSBA 7028 第1讲', duration: '58分',       notes: '12页笔记', date: '2026-04-08', status: 'done' },
  { id: 's4', title: 'MSBA 7028 第4讲', duration: '处理中...',  notes: '—',        date: '2026-04-13', status: 'loading' },
]

export default function LobbyPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* ── 左侧边栏 240px ── */}
      <aside className="w-60 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-gray-200">
          <span className="text-lg font-bold text-gray-900">LiberStudy</span>
        </div>

        {/* 搜索栏 */}
        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 h-9 px-3 bg-white border border-gray-200 rounded-md text-sm text-gray-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            搜索课程... Ctrl+K
          </div>
        </div>

        {/* 新建 + 录音按钮 */}
        <div className="px-3 pt-3 flex flex-col gap-2">
          <button
            onClick={() => navigate('/session')}
            className="w-full h-10 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800 transition-colors"
          >
            ＋ 新建课堂
          </button>
          <button
            onClick={() => navigate('/session')}
            className="w-full h-10 bg-blue-50 text-blue-500 text-sm font-medium rounded-md border border-blue-300 hover:bg-blue-100 transition-colors"
          >
            🎙️ 开始录音
          </button>
        </div>

        {/* 分隔线 */}
        <div className="mx-3 mt-3 border-t border-gray-200" />

        {/* 课程列表 */}
        <div className="px-3 pt-3 flex-1 overflow-y-auto">
          <p className="text-xs text-gray-400 font-medium px-2 mb-2">我的课程</p>
          <ul className="flex flex-col gap-1">
            {COURSES.map(c => (
              <li key={c.id}>
                <button className={`w-full text-left px-3 h-8 rounded-md text-sm transition-colors ${
                  c.active ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-700 hover:bg-gray-100'
                }`}>
                  📁 {c.name}
                </button>
              </li>
            ))}
          </ul>
          <button className="mt-2 w-full text-left px-3 h-8 rounded-md text-sm text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors">
            ＋ 新建课程
          </button>
        </div>

        {/* 底部用户信息 */}
        <div className="border-t border-gray-200 px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-300 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">小林</p>
            <p className="text-xs text-gray-500">今日剩余：1/2 节课</p>
          </div>
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
      </aside>

      {/* ── 右侧主内容区 ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-gray-200 flex-shrink-0">
          <h1 className="text-xl font-bold text-gray-900">MSBA 7028</h1>
          {/* Grid/List 分段控制器 */}
          <div className="flex items-center h-8 bg-gray-100 rounded-lg p-0.5 gap-0.5">
            <button className="px-3 h-7 rounded-md bg-white text-gray-700 text-sm shadow-sm">
              ▦
            </button>
            <button className="px-3 h-7 rounded-md text-gray-500 text-sm hover:bg-gray-200">
              ☰
            </button>
          </div>
        </header>

        {/* 网格区 */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <p className="text-sm text-gray-500 mb-6">共 {SESSIONS.length} 节课  ·  最近访问：2026-04-12</p>
          <div className="grid grid-cols-4 gap-6">
            {SESSIONS.map(s => (
              <div
                key={s.id}
                onClick={() => s.status === 'done' && navigate(`/notes/${s.id}`)}
                className={`border border-gray-200 rounded-lg overflow-hidden ${
                  s.status === 'done' ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
                }`}
              >
                {/* 封面区 128px 高 */}
                {s.status === 'loading' ? (
                  <div className="h-32 bg-gray-100 flex flex-col justify-end p-4">
                    <p className="text-sm text-gray-400 mb-2">解析中...</p>
                    <div className="h-1 bg-gray-200 rounded-full">
                      <div className="h-1 bg-gray-700 rounded-full w-3/5" />
                    </div>
                  </div>
                ) : (
                  <div className="h-32 bg-gray-100 flex items-center justify-center">
                    <span className="text-sm text-gray-400">PPT 封面预览</span>
                  </div>
                )}
                {/* 信息区 */}
                <div className="p-4">
                  <p className="text-sm font-medium text-gray-900 mb-1 truncate">{s.title}</p>
                  <p className="text-xs text-gray-500">{s.duration}  ·  {s.notes}</p>
                  <p className="text-xs text-gray-400 mt-1">{s.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
