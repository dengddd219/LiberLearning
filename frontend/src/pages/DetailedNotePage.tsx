import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

// Static mock data — replace with real API call when backend is ready
const MOCK_NOTE = {
  tag: 'ADVANCED PHILOSOPHY',
  date: 'OCT 24, 2023',
  title: '7. 物品冷启动 (Cold Start Problem)',
  sections: [
    {
      type: 'heading' as const,
      text: '1. 什么是冷启动问题？',
    },
    {
      type: 'paragraph' as const,
      text: '冷启动（Cold Start）是推荐系统领域的经典难题，指系统在缺乏足够历史数据时无法准确建立用户偏好模型或物品相关性的状态。根据数据缺失的主体不同，冷启动分为三类：',
    },
    {
      type: 'bullets' as const,
      items: [
        '用户冷启动（User Cold Start）：新用户注册时系统没有其行为数据',
        '物品冷启动（Item Cold Start）：新物品上线时没有用户交互记录',
        '系统冷启动（System Cold Start）：整个推荐系统从零开始运作',
      ],
    },
    {
      type: 'heading' as const,
      text: '2. 物品冷启动的核心挑战',
    },
    {
      type: 'paragraph' as const,
      text: '协同过滤（Collaborative Filtering）完全依赖用户行为数据（点击、购买、评分等）建立物品相似度矩阵。当一个新物品上线时，由于没有任何交互记录，协同过滤算法无法将其与现有物品建立有效的相似关系，导致新物品无法获得有效曝光，陷入"曝光不足 → 数据不足 → 继续无法曝光"的死循环。',
    },
    {
      type: 'definition' as const,
      term: 'Explore-Exploit Tradeoff',
      text: '在冷启动场景下，系统需要在"探索（Explore）"新物品（冒险曝光、收集数据）与"利用（Exploit）"已有高质量物品（保证用户体验）之间取得平衡。这一权衡是推荐系统设计的核心矛盾之一。',
    },
    {
      type: 'heading' as const,
      text: '3. 主流解决方案',
    },
    {
      type: 'bullets' as const,
      items: [
        '基于内容的特征匹配（Content-Based Filtering）：利用物品属性标签（类别、关键词、作者等）建立初始相似度',
        '多层流量池机制（如小红书）：新内容进入小流量池测试，根据指标（完播率、互动率）决定是否晋级到更大流量池',
        '混合模型（Hybrid Model）：在数据积累早期用内容特征兜底，数据丰富后切换协同过滤',
        '用户注册引导（Onboarding Survey）：显性收集新用户偏好，快速构建初始画像',
        '迁移学习（Transfer Learning）：从相关领域或跨平台数据迁移知识',
      ],
    },
  ],
  aiSection: {
    heading: 'AI 补充说明',
    content: '老师在讲这一章时重点强调了小红书的流量池机制作为工业界物品冷启动的典型案例。值得注意的是，这一机制本质上是一种在线实验框架（Online Experimentation），每个流量池都是一个自然实验，用真实用户行为作为物品质量的代理指标（Proxy Metric），从而在不需要人工干预的情况下完成物品筛选。这与传统的离线评估范式有本质区别，也是互联网推荐系统与学术推荐系统最大的工程差异之一。',
  },
}

export default function DetailedNotePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('ai')

  // 后端接通后，这里改为从 API 拿真实 pages 列表
  const MOCK_PAGE_IDS = ['s1', 's2', 's3', 's4']
  const currentIndex = MOCK_PAGE_IDS.indexOf(sessionId ?? '')
  const prevId = currentIndex > 0 ? MOCK_PAGE_IDS[currentIndex - 1] : null
  const nextId = currentIndex < MOCK_PAGE_IDS.length - 1 ? MOCK_PAGE_IDS[currentIndex + 1] : null
  const headingRefs = useRef<Map<number, HTMLHeadingElement>>(new Map())
  const aiSectionRef = useRef<HTMLDivElement>(null)

  return (
    <div className="min-h-screen" style={{ background: '#FAF9F7', fontFamily: 'Inter, sans-serif', paddingTop: '64px' }}>

      {/* Page layout: sidebar + content */}
      <div className="flex" style={{ minHeight: 'calc(100vh - 64px - 40px)' }}>

        {/* Left sidebar */}
        <aside
          className="flex-shrink-0 flex flex-col"
          style={{
            width: '200px',
            background: '#F3F4F1',
            borderRight: '1px solid rgba(175,179,176,0.1)',
            position: 'sticky',
            top: '64px',
            height: 'calc(100vh - 64px)',
            overflowY: 'auto',
          }}
        >
          <div
            className="flex items-center px-4"
            style={{ height: '48px', borderBottom: '1px solid rgba(175,179,176,0.1)' }}
          >
            <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: '#556071' }}>
              NAVIGATION
            </span>
          </div>
          <div className="p-3" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all duration-150 w-full text-left hover:bg-black/5"
              style={{ color: '#556071' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              返回
            </button>
            {MOCK_NOTE.sections
              .filter((s) => s.type === 'heading')
              .map((s, i) => (
                <button
                  key={i}
                  onClick={() => headingRefs.current.get(i)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="px-3 py-2 rounded-lg text-sm cursor-pointer transition-all duration-150 w-full text-left hover:bg-black/5"
                  style={{ color: '#777C79', lineHeight: '1.4' }}
                >
                  {'text' in s ? s.text : ''}
                </button>
              ))}
            <button
              onClick={() => aiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all duration-150 w-full text-left hover:bg-black/5"
              style={{ color: '#556071' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              AI 说明
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto px-16 py-12" style={{ maxWidth: '800px' }}>

            {/* My Notes / AI Notes Pill toggle */}
            <div className="flex items-center justify-between mb-8">
              <div className="inline-flex rounded-full p-0.5" style={{ background: 'rgba(175,179,176,0.15)' }}>
                {(['my', 'ai'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setNoteMode(mode)}
                    className="px-4 py-1 rounded-full text-sm cursor-pointer transition-all duration-150"
                    style={{
                      background: noteMode === mode ? '#FFFFFF' : 'transparent',
                      color: noteMode === mode ? '#2F3331' : '#556071',
                      fontWeight: noteMode === mode ? '500' : '400',
                      boxShadow: noteMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    }}
                  >
                    {mode === 'my' ? 'My Notes' : 'AI Notes'}
                  </button>
                ))}
              </div>
            </div>

            {/* Metadata header */}
            <div className="flex items-center gap-3 mb-4">
              <span
                className="text-xs font-medium px-3 py-1 rounded-full"
                style={{
                  background: '#F3F4F1',
                  color: '#556071',
                  letterSpacing: '0.05em',
                  fontWeight: '600',
                }}
              >
                {MOCK_NOTE.tag}
              </span>
              <span style={{ fontSize: '12px', color: '#AFB3B0' }}>{MOCK_NOTE.date}</span>
              {sessionId && (
                <span style={{ fontSize: '12px', color: '#AFB3B0' }}>· Session {sessionId}</span>
              )}
            </div>

            {/* Title */}
            <h1
              className="mb-10"
              style={{
                fontSize: '36px',
                fontWeight: '700',
                color: '#2F3331',
                lineHeight: '1.2',
                letterSpacing: '-0.02em',
              }}
            >
              {MOCK_NOTE.title}
            </h1>

            {/* Content sections */}
            {noteMode === 'my' ? (
              <div className="py-8 text-center" style={{ color: '#8a8f8a', fontSize: '14px' }}>
                你还没有添加手动笔记
              </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {(() => {
                let headingIndex = 0
                return MOCK_NOTE.sections.map((section, i) => {
                  if (section.type === 'heading') {
                    const idx = headingIndex++
                    return (
                      <h3
                        key={i}
                        ref={(el) => { if (el) headingRefs.current.set(idx, el) }}
                        style={{
                          fontSize: '18px',
                          fontWeight: '700',
                          color: '#2F3331',
                          marginTop: '8px',
                          paddingBottom: '8px',
                          borderBottom: '1px solid rgba(175,179,176,0.2)',
                        }}
                      >
                        {'text' in section ? section.text : ''}
                      </h3>
                    )
                  }

                  if (section.type === 'paragraph') {
                    return (
                      <p
                        key={i}
                        style={{
                          fontSize: '15px',
                          color: '#2F3331',
                          lineHeight: '1.8',
                        }}
                      >
                        {'text' in section ? section.text : ''}
                      </p>
                    )
                  }

                  if (section.type === 'bullets') {
                    return (
                      <ul key={i} style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingLeft: '4px' }}>
                        {'items' in section && section.items.map((item, j) => (
                          <li key={j} className="flex items-start gap-3">
                            <span
                              className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full"
                              style={{ background: '#556071' }}
                            />
                            <span style={{ fontSize: '15px', color: '#2F3331', lineHeight: '1.7' }}>
                              {item}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  }

                  if (section.type === 'definition') {
                    return (
                      <div
                        key={i}
                        className="rounded-lg p-4"
                        style={{ background: '#F3F4F1', border: '1px solid rgba(175,179,176,0.2)' }}
                      >
                        <p className="mb-2">
                          <code
                            style={{
                              fontSize: '13px',
                              fontWeight: '700',
                              color: '#556071',
                              background: 'rgba(85,96,113,0.08)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                            }}
                          >
                            {'term' in section ? section.term : ''}
                          </code>
                        </p>
                        <p style={{ fontSize: '14px', color: '#2F3331', lineHeight: '1.7' }}>
                          {'text' in section ? section.text : ''}
                        </p>
                      </div>
                    )
                  }

                  return null
                })
              })()}

              {/* AI Notes section */}
              <div
                ref={aiSectionRef}
                className="rounded-xl p-6 mt-4"
                style={{
                  background: '#FAFAFA',
                  border: '1px solid rgba(175,179,176,0.2)',
                  borderLeft: '3px solid rgba(85,96,113,0.25)',
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#556071" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <h2 style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.1em', color: '#556071', margin: 0 }}>
                    {MOCK_NOTE.aiSection.heading.toUpperCase()}
                  </h2>
                </div>
                <p style={{ fontSize: '14px', color: '#374151', lineHeight: '1.8' }}>
                  {MOCK_NOTE.aiSection.content}
                </p>
              </div>
            </div>
            )}

            {/* Bottom Navigation */}
            <div className="flex justify-between items-center py-8 mt-4" style={{ borderTop: '1px solid rgba(175,179,176,0.2)' }}>
              <button
                onClick={() => prevId && navigate(`/notes/detail/${prevId}`)}
                disabled={!prevId}
                className="flex items-center gap-2 text-sm cursor-pointer transition-all duration-150"
                style={{ color: prevId ? '#2F3331' : '#C4C7C4', background: 'none', border: 'none' }}
              >
                ← PREVIOUS
              </button>
              <button
                onClick={() => nextId && navigate(`/notes/detail/${nextId}`)}
                disabled={!nextId}
                className="flex items-center gap-2 text-sm cursor-pointer transition-all duration-150"
                style={{ color: nextId ? '#2F3331' : '#C4C7C4', background: 'none', border: 'none' }}
              >
                NEXT →
              </button>
            </div>
            <div style={{ height: '80px' }} />
          </div>
        </main>
      </div>

      {/* Global Footer */}
      <footer
        className="flex items-center justify-center"
        style={{
          height: '40px',
          background: '#FAF9F7',
          borderTop: '1px solid rgba(175,179,176,0.1)',
          color: '#AFB3B0',
          fontSize: '11px',
        }}
      >
        LiberStudy · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
