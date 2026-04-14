import { useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

// Static mock data — replace with real API call when backend is ready
const MOCK_NOTE = {
  tag: 'ADVANCED PHILOSOPHY',
  date: 'OCT 24, 2023',
  title: '7. 物品冷启动 (Cold Start Problem)',
  author: 'Prof. Aris Thorne',
  readTime: '45 min read',
  summary: 'The "Cold Start" problem in recommendation systems refers to the challenge of providing relevant suggestions when there is insufficient data about a new item or user. This lecture explores strategies for overcoming this hurdle through content-based filtering and hybrid metadata modeling.',
  sections: [
    {
      type: 'heading' as const,
      text: '1. Definition of Item Cold Start',
    },
    {
      type: 'paragraph' as const,
      text: 'An item cold start occurs when a new product is added to the catalog. Since no users have interacted with it yet, collaborative filtering algorithms cannot find "similar users" to recommend it to. This creates a "chicken and egg" paradox in data-driven discovery.',
    },
    {
      type: 'ai-callout' as const,
      label: 'AI PERSPECTIVE: CROSS-DOMAIN MAPPING',
      text: 'Think of this as a library adding a book in a language no one has read yet. To suggest it, the librarian must look at the cover, the author, and the genre (metadata) rather than who checked it out previously.',
    },
    {
      type: 'heading' as const,
      text: '2. Content-Based Approaches',
    },
    {
      type: 'paragraph' as const,
      text: "The most common solution involves leveraging feature extraction. By analyzing the item's inherent properties—such as text descriptions, visual aesthetics, or categorical tags—we can map the new item into an existing embedding space.",
    },
  ],
  methods: [
    {
      label: 'METHOD A',
      title: 'Zero-Shot Learning',
      desc: 'Leveraging pre-trained neural networks to understand item semantics without specific interaction data.',
      style: 'white' as const,
    },
    {
      label: 'METHOD B',
      title: 'Active Exploration',
      desc: 'Strategically showing new items to a diverse subset of users to gather initial training signals quickly.',
      style: 'stone' as const,
    },
  ],
  observations: {
    heading: 'DETAILED OBSERVATIONS',
    paragraphs: [
      'During the Q&A, the professor emphasized that the "Warm-up" phase is just as critical as the initial "Cold" state. As soon as the first 5-10 interactions are recorded, the model should pivot from pure content-based filtering to a hybrid approach to avoid the "Filter Bubble" effect.',
      'Final takeaway: The goal of cold start management is not just to find *any* user, but to find the *right* early adopters who can provide high-quality signal for the broader community.',
    ],
    figCaption: 'Fig 7.1: The transition from sparse metadata to dense interaction manifolds.',
  },
  prev: '6. Collaborative Filtering',
  next: '8. Feedback Loops',
}

// SVG Icons
const IconBell = ({ color = '#556071' }: { color?: string }) => (
  <svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 17V15H2V8C2 6.61667 2.41667 5.3875 3.25 4.3125C4.08333 3.2375 5.16667 2.53333 6.5 2.2V1.5C6.5 1.08333 6.64583 0.729167 6.9375 0.4375C7.22917 0.145833 7.58333 0 8 0C8.41667 0 8.77083 0.145833 9.0625 0.4375C9.35417 0.729167 9.5 1.08333 9.5 1.5V2.2C10.8333 2.53333 11.9167 3.2375 12.75 4.3125C13.5833 5.3875 14 6.61667 14 8V15H16V17H0ZM8 20C7.45 20 6.97917 19.8042 6.5875 19.4125C6.19583 19.0208 6 18.55 6 18H10C10 18.55 9.80417 19.0208 9.4125 19.4125C9.02083 19.8042 8.55 20 8 20ZM4 15H12V8C12 6.9 11.6083 5.95833 10.825 5.175C10.0417 4.39167 9.1 4 8 4C6.9 4 5.95833 4.39167 5.175 5.175C4.39167 5.95833 4 6.9 4 8V15Z" fill={color} />
  </svg>
)

const IconUser = ({ color = '#5C605D' }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.66667 4.66667C4.025 4.66667 3.47569 4.43819 3.01875 3.98125C2.56181 3.52431 2.33333 2.975 2.33333 2.33333C2.33333 1.69167 2.56181 1.14236 3.01875 0.685417C3.47569 0.228472 4.025 0 4.66667 0C5.30833 0 5.85764 0.228472 6.31458 0.685417C6.77153 1.14236 7 1.69167 7 2.33333C7 2.975 6.77153 3.52431 6.31458 3.98125C5.85764 4.43819 5.30833 4.66667 4.66667 4.66667ZM0 9.33333V7.7C0 7.36944 0.0850694 7.06563 0.255208 6.78854C0.425347 6.51146 0.651389 6.3 0.933333 6.15417C1.53611 5.85278 2.14861 5.62674 2.77083 5.47604C3.39306 5.32535 4.025 5.25 4.66667 5.25C5.30833 5.25 5.94028 5.32535 6.5625 5.47604C7.18472 5.62674 7.79722 5.85278 8.4 6.15417C8.68194 6.3 8.90799 6.51146 9.07812 6.78854C9.24826 7.06563 9.33333 7.36944 9.33333 7.7V9.33333H0ZM1.16667 8.16667H8.16667V7.7C8.16667 7.59306 8.13993 7.49583 8.08646 7.40833C8.03299 7.32083 7.9625 7.25278 7.875 7.20417C7.35 6.94167 6.82014 6.74479 6.28542 6.61354C5.75069 6.48229 5.21111 6.41667 4.66667 6.41667C4.12222 6.41667 3.58264 6.48229 3.04792 6.61354C2.51319 6.74479 1.98333 6.94167 1.45833 7.20417C1.37083 7.25278 1.30035 7.32083 1.24688 7.40833C1.1934 7.49583 1.16667 7.59306 1.16667 7.7V8.16667ZM4.66667 3.5C4.9875 3.5 5.26215 3.38576 5.49062 3.15729C5.7191 2.92882 5.83333 2.65417 5.83333 2.33333C5.83333 2.0125 5.7191 1.73785 5.49062 1.50937C5.26215 1.2809 4.9875 1.16667 4.66667 1.16667C4.34583 1.16667 4.07118 1.2809 3.84271 1.50937C3.61424 1.73785 3.5 2.0125 3.5 2.33333C3.5 2.65417 3.61424 2.92882 3.84271 3.15729C4.07118 3.38576 4.34583 3.5 4.66667 3.5Z" fill={color} />
  </svg>
)

const IconClock = ({ color = '#5C605D' }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.75833 8.575L8.575 7.75833L6.41667 5.6V2.91667H5.25V6.06667L7.75833 8.575ZM5.83333 11.6667C5.02639 11.6667 4.26806 11.5135 3.55833 11.2073C2.84861 10.901 2.23125 10.4854 1.70625 9.96042C1.18125 9.43542 0.765625 8.81806 0.459375 8.10833C0.153125 7.39861 0 6.64028 0 5.83333C0 5.02639 0.153125 4.26806 0.459375 3.55833C0.765625 2.84861 1.18125 2.23125 1.70625 1.70625C2.23125 1.18125 2.84861 0.765625 3.55833 0.459375C4.26806 0.153125 5.02639 0 5.83333 0C6.64028 0 7.39861 0.153125 8.10833 0.459375C8.81806 0.765625 9.43542 1.18125 9.96042 1.70625C10.4854 2.23125 10.901 2.84861 11.2073 3.55833C11.5135 4.26806 11.6667 5.02639 11.6667 5.83333C11.6667 6.64028 11.5135 7.39861 11.2073 8.10833C10.901 8.81806 10.4854 9.43542 9.96042 9.96042C9.43542 10.4854 8.81806 10.901 8.10833 11.2073C7.39861 11.5135 6.64028 11.6667 5.83333 11.6667ZM5.83333 10.5C7.12639 10.5 8.22743 10.0455 9.13646 9.13646C10.0455 8.22743 10.5 7.12639 10.5 5.83333C10.5 4.54028 10.0455 3.43924 9.13646 2.53021C8.22743 1.62118 7.12639 1.16667 5.83333 1.16667C4.54028 1.16667 3.43924 1.62118 2.53021 2.53021C1.62118 3.43924 1.16667 4.54028 1.16667 5.83333C1.16667 7.12639 1.62118 8.22743 2.53021 9.13646C3.43924 10.0455 4.54028 10.5 5.83333 10.5Z" fill={color} />
  </svg>
)

const IconAIStar = ({ color = '#556071', size = 17 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.5 6L12.5625 3.9375L10.5 3L12.5625 2.0625L13.5 0L14.4375 2.0625L16.5 3L14.4375 3.9375L13.5 6ZM13.5 16.5L12.5625 14.4375L10.5 13.5L12.5625 12.5625L13.5 10.5L14.4375 12.5625L16.5 13.5L14.4375 14.4375L13.5 16.5ZM6 14.25L4.125 10.125L0 8.25L4.125 6.375L6 2.25L7.875 6.375L12 8.25L7.875 10.125L6 14.25ZM6 10.6125L6.75 9L8.3625 8.25L6.75 7.5L6 5.8875L5.25 7.5L3.6375 8.25L5.25 9L6 10.6125Z" fill={color} />
  </svg>
)

const IconAIStarSm = ({ color = '#486272' }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.5 4.66667L9.77083 3.0625L8.16667 2.33333L9.77083 1.60417L10.5 0L11.2292 1.60417L12.8333 2.33333L11.2292 3.0625L10.5 4.66667ZM10.5 12.8333L9.77083 11.2292L8.16667 10.5L9.77083 9.77083L10.5 8.16667L11.2292 9.77083L12.8333 10.5L11.2292 11.2292L10.5 12.8333ZM4.66667 11.0833L3.20833 7.875L0 6.41667L3.20833 4.95833L4.66667 1.75L6.125 4.95833L9.33333 6.41667L6.125 7.875L4.66667 11.0833ZM4.66667 8.25417L5.25 7L6.50417 6.41667L5.25 5.83333L4.66667 4.57917L4.08333 5.83333L2.82917 6.41667L4.08333 7L4.66667 8.25417Z" fill={color} />
  </svg>
)

const IconNotes = ({ color = '#2F3331' }: { color?: string }) => (
  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 7.5V6H5.25V7.5H0ZM0 4.5V3H8.25V4.5H0ZM0 1.5V0H8.25V1.5H0ZM6.75 12V9.69375L10.8938 5.56875C11.0063 5.45625 11.1313 5.375 11.2688 5.325C11.4062 5.275 11.5437 5.25 11.6812 5.25C11.8312 5.25 11.975 5.27812 12.1125 5.33437C12.25 5.39062 12.375 5.475 12.4875 5.5875L13.1812 6.28125C13.2812 6.39375 13.3594 6.51875 13.4156 6.65625C13.4719 6.79375 13.5 6.93125 13.5 7.06875C13.5 7.20625 13.475 7.34687 13.425 7.49062C13.375 7.63438 13.2937 7.7625 13.1812 7.875L9.05625 12H6.75ZM12.375 7.06875L11.6812 6.375L12.375 7.06875ZM7.875 10.875H8.5875L10.8562 8.5875L10.5188 8.23125L10.1625 7.89375L7.875 10.1625V10.875ZM10.5188 8.23125L10.1625 7.89375L10.8562 8.5875L10.5188 8.23125Z" fill={color} />
  </svg>
)

const IconArrowRight = ({ color = '#2F3331' }: { color?: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.175 9H0V7H12.175L6.575 1.4L8 0L16 8L8 16L6.575 14.6L12.175 9Z" fill={color} />
  </svg>
)

const IconArrowLeft = ({ color = '#2F3331' }: { color?: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.825 9L9.425 14.6L8 16L0 8L8 0L9.425 1.4L3.825 7H16V9H3.825Z" fill={color} />
  </svg>
)

export default function DetailedNotePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const observationsRef = useRef<HTMLDivElement>(null)

  return (
    <div
      className="w-full min-h-screen relative inline-flex flex-col justify-start items-start"
      style={{ background: '#FAF9F7', fontFamily: "Inter, sans-serif" }}
    >
      {/* TopAppBar */}
      <header
        className="w-full px-8 inline-flex justify-between items-center flex-shrink-0"
        style={{
          height: '64px',
          background: 'rgba(250,249,247,0.8)',
          backdropFilter: 'blur(6px)',
          position: 'sticky',
          top: 0,
          zIndex: 30,
          boxShadow: '0px 40px 40px -15px rgba(47,51,49,0.04)',
        }}
      >
        {/* Left: Logo + Nav */}
        <div className="flex justify-start items-center gap-8">
          <span
            className="font-bold"
            style={{ fontSize: '20px', lineHeight: '28px', color: '#2F3331' }}
          >
            LiberStudy
          </span>
          <nav className="flex justify-start items-center gap-6">
            {(['Dashboard', 'Courses', 'Detailed Note'] as const).map((item) => (
              <button
                key={item}
                onClick={() => { if (item !== 'Detailed Note') navigate('/') }}
                className="cursor-pointer"
                style={{
                  fontSize: '16px',
                  lineHeight: '24px',
                  color: item === 'Detailed Note' ? '#000000' : '#556071',
                  fontWeight: '400',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  paddingBottom: item === 'Detailed Note' ? 0 : 0,
                  borderBottom: item === 'Detailed Note' ? '2px solid #2F3331' : 'none',
                }}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: icons + avatar */}
        <div className="flex justify-start items-center gap-4">
          <button type="button" aria-label="通知" className="p-3 rounded-full cursor-pointer flex justify-center items-center">
            <IconBell color="#556071" aria-hidden="true" />
          </button>
          <button type="button" aria-label="用户菜单" className="p-3 rounded-full cursor-pointer flex justify-center items-center">
            <IconUser color="#556071" aria-hidden="true" />
          </button>
          <div
            className="rounded-full overflow-hidden flex-shrink-0"
            style={{ width: '32px', height: '32px', background: '#E6E9E6' }}
          >
            <img
              src="https://placehold.co/32x32"
              alt="avatar"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </header>

      {/* Main content area */}
      <div className="w-full flex-1 flex justify-center">
        <div
          className="w-full relative flex flex-col justify-start items-start"
          style={{ maxWidth: '768px', padding: '0 0 64px 0' }}
        >
          {/* Pill Toggle — fixed below header */}
          <div
            className="w-full flex justify-center items-start pb-12"
            style={{ paddingTop: '32px' }}
          >
            <div
              className="p-1.5 rounded-full flex justify-start items-start gap-1"
              style={{
                background: '#F3F4F1',
                boxShadow: '0px 1px 2px 0px rgba(0,0,0,0.05)',
                backdropFilter: 'blur(6px)',
              }}
            >
              {/* My Notes — active */}
              <div
                className="px-6 py-2 rounded-full flex justify-start items-center gap-2"
                style={{
                  background: '#FFFFFF',
                  boxShadow: '0px 1px 2px 0px rgba(0,0,0,0.05)',
                }}
              >
                <IconNotes color="#2F3331" />
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: '500',
                    lineHeight: '20px',
                    color: '#2F3331',
                  }}
                >
                  My Notes
                </span>
              </div>
              {/* AI Notes — inactive */}
              <div className="px-6 py-2 rounded-full flex justify-start items-center gap-2 cursor-pointer">
                <IconAIStar color="#556071" size={16} />
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: '500',
                    lineHeight: '20px',
                    color: '#556071',
                  }}
                >
                  AI Notes
                </span>
              </div>
            </div>
          </div>

          {/* Article header */}
          <div className="w-full flex flex-col justify-start items-start" style={{ gap: '16px' }}>
            {/* Tag + Date row */}
            <div className="inline-flex justify-start items-center gap-3">
              <div
                className="px-2 py-0.5 rounded-2xl inline-flex flex-col justify-start items-start"
                style={{ background: '#E6E9E6' }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: '500',
                    lineHeight: '16px',
                    letterSpacing: '0.05em',
                    color: '#556071',
                    textTransform: 'uppercase',
                  }}
                >
                  {MOCK_NOTE.tag}
                </span>
              </div>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: '500',
                  lineHeight: '16px',
                  letterSpacing: '0.05em',
                  color: '#777C79',
                  textTransform: 'uppercase',
                }}
              >
                {MOCK_NOTE.date}
                {sessionId && ` · Session ${sessionId}`}
              </span>
            </div>

            {/* Title */}
            <div className="w-full flex flex-col justify-start items-start">
              <h1
                style={{
                  fontSize: '48px',
                  fontWeight: '800',
                  lineHeight: '60px',
                  color: '#27272A',
                }}
              >
                {MOCK_NOTE.title}
              </h1>
            </div>

            {/* Author + read time */}
            <div className="w-full pt-4 inline-flex justify-start items-center gap-4">
              <div className="flex justify-start items-center gap-1.5">
                {/* author dot */}
                <div style={{ width: '10px', height: '10px', background: '#52525B', flexShrink: 0 }} />
                <span style={{ fontSize: '14px', color: '#52525B', lineHeight: '20px' }}>
                  {MOCK_NOTE.author}
                </span>
              </div>
              <div
                style={{ width: '4px', height: '4px', background: '#A1A1AA', borderRadius: '50%' }}
              />
              <div className="flex justify-start items-center gap-1.5">
                <IconClock color="#52525B" />
                <span style={{ fontSize: '14px', color: '#52525B', lineHeight: '20px' }}>
                  {MOCK_NOTE.readTime}
                </span>
              </div>
            </div>
          </div>

          {/* Content body */}
          <div
            className="w-full flex flex-col justify-start items-start"
            style={{ marginTop: '64px', gap: '64px' }}
          >
            {/* Summary section */}
            <div className="w-full flex flex-col justify-start items-start gap-6">
              <h2
                style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  lineHeight: '16px',
                  letterSpacing: '0.1em',
                  color: '#52525B',
                  textTransform: 'uppercase',
                }}
              >
                SUMMARY
              </h2>
              <p
                style={{
                  fontSize: '18px',
                  fontWeight: '400',
                  lineHeight: '28px',
                  color: '#475569',
                }}
              >
                {MOCK_NOTE.summary}
              </p>
            </div>

            {/* Key Concepts section */}
            <div className="w-full flex flex-col justify-start items-start gap-8">
              <h2
                style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  lineHeight: '16px',
                  letterSpacing: '0.1em',
                  color: '#52525B',
                  textTransform: 'uppercase',
                }}
              >
                KEY CONCEPTS
              </h2>

              {MOCK_NOTE.sections.map((section, i) => {
                if (section.type === 'heading') {
                  return (
                    <div key={i} className="w-full flex flex-col justify-start items-start gap-2.5">
                      <h3
                        style={{
                          fontSize: '20px',
                          fontWeight: '700',
                          lineHeight: '28px',
                          color: '#27272A',
                        }}
                      >
                        {section.text}
                      </h3>
                    </div>
                  )
                }

                if (section.type === 'paragraph') {
                  return (
                    <div key={i} className="w-full flex flex-col justify-start items-start">
                      <p
                        style={{
                          fontSize: '18px',
                          fontWeight: '400',
                          lineHeight: '32px',
                          color: '#27272A',
                        }}
                      >
                        {section.text}
                      </p>
                    </div>
                  )
                }

                if (section.type === 'ai-callout') {
                  return (
                    <div
                      key={i}
                      className="w-full pl-8 py-2 flex flex-col justify-start items-start gap-3"
                      style={{ borderLeft: '4px solid #E6E9E6' }}
                    >
                      <div className="inline-flex justify-start items-center gap-2">
                        <IconAIStarSm color="#486272" />
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            lineHeight: '16px',
                            letterSpacing: '0.05em',
                            color: '#475569',
                            textTransform: 'uppercase',
                          }}
                        >
                          {section.label}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: '16px',
                          fontWeight: '400',
                          lineHeight: '28px',
                          color: '#475569',
                        }}
                      >
                        {section.text}
                      </p>
                    </div>
                  )
                }

                return null
              })}
            </div>

            {/* Methods cards */}
            <div className="w-full py-8 inline-flex flex-col justify-start items-start">
              {/* Method A — white card */}
              <div
                className="w-full p-8 inline-flex flex-col justify-between items-start"
                style={{
                  background: '#FFFFFF',
                  borderRadius: '32px',
                  boxShadow: '0px 40px 40px -15px rgba(47,51,49,0.04)',
                }}
              >
                <div className="w-full flex flex-col justify-start items-start gap-1.5">
                  <h4
                    style={{
                      fontSize: '16px',
                      fontWeight: '700',
                      lineHeight: '24px',
                      color: '#27272A',
                    }}
                  >
                    {MOCK_NOTE.methods[0].title}
                  </h4>
                  <p
                    style={{
                      fontSize: '14px',
                      fontWeight: '400',
                      lineHeight: '24px',
                      color: '#475569',
                    }}
                  >
                    {MOCK_NOTE.methods[0].desc}
                  </p>
                </div>
                <div className="w-full pt-6 flex flex-col justify-start items-start">
                  <div
                    className="w-full pt-6 inline-flex justify-between items-center"
                    style={{ borderTop: '1px solid #F5F5F4' }}
                  >
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: '500',
                        lineHeight: '16px',
                        letterSpacing: '0.05em',
                        color: '#737373',
                        textTransform: 'uppercase',
                      }}
                    >
                      {MOCK_NOTE.methods[0].label}
                    </span>
                    <IconArrowRight color="#3F3F46" />
                  </div>
                </div>
              </div>

              {/* Method B — stone card */}
              <div
                className="w-full p-8 inline-flex flex-col justify-between items-start"
                style={{
                  background: '#F5F5F4',
                  borderRadius: '32px',
                }}
              >
                <div className="w-full flex flex-col justify-start items-start gap-1.5">
                  <h4
                    style={{
                      fontSize: '16px',
                      fontWeight: '700',
                      lineHeight: '24px',
                      color: '#27272A',
                    }}
                  >
                    {MOCK_NOTE.methods[1].title}
                  </h4>
                  <p
                    style={{
                      fontSize: '14px',
                      fontWeight: '400',
                      lineHeight: '24px',
                      color: '#475569',
                    }}
                  >
                    {MOCK_NOTE.methods[1].desc}
                  </p>
                </div>
                <div className="w-full pt-6 flex flex-col justify-start items-start">
                  <div
                    className="w-full pt-6 inline-flex justify-between items-center"
                    style={{ borderTop: '1px solid #E6E9E6' }}
                  >
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: '500',
                        lineHeight: '16px',
                        letterSpacing: '0.05em',
                        color: '#737373',
                        textTransform: 'uppercase',
                      }}
                    >
                      {MOCK_NOTE.methods[1].label}
                    </span>
                    <IconArrowRight color="#3F3F46" />
                  </div>
                </div>
              </div>
            </div>

            {/* Detailed Observations section */}
            <div
              ref={observationsRef}
              className="w-full flex flex-col justify-start items-start gap-12"
            >
              <h2
                style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  lineHeight: '16px',
                  letterSpacing: '0.1em',
                  color: '#52525B',
                  textTransform: 'uppercase',
                }}
              >
                {MOCK_NOTE.observations.heading}
              </h2>
              <div className="w-full flex flex-col justify-start items-start gap-6">
                <p
                  style={{
                    fontSize: '18px',
                    fontWeight: '400',
                    lineHeight: '32px',
                    color: '#27272A',
                  }}
                >
                  {MOCK_NOTE.observations.paragraphs[0]}
                </p>

                {/* Figure */}
                <div className="w-full pt-px flex flex-col justify-start items-start gap-4">
                  <div
                    className="w-full rounded-3xl overflow-hidden"
                    style={{
                      background: '#E6E9E6',
                      boxShadow: '0px 1px 2px 0px rgba(0,0,0,0.05)',
                    }}
                  >
                    <img
                      className="w-full"
                      style={{ height: '384px', objectFit: 'cover', opacity: 0.8, mixBlendMode: 'overlay' }}
                      src="https://placehold.co/768x432"
                      alt="Fig 7.1"
                    />
                  </div>
                  <p
                    style={{
                      width: '100%',
                      textAlign: 'center',
                      fontSize: '12px',
                      fontWeight: '400',
                      lineHeight: '16px',
                      color: '#737373',
                    }}
                  >
                    {MOCK_NOTE.observations.figCaption}
                  </p>
                </div>

                <p
                  style={{
                    fontSize: '18px',
                    fontWeight: '400',
                    lineHeight: '32px',
                    color: '#27272A',
                  }}
                >
                  {MOCK_NOTE.observations.paragraphs[1]}
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Navigation */}
          <div
            className="w-full pt-16 inline-flex justify-between items-center"
            style={{
              marginTop: '64px',
              borderTop: '1px solid #E6E9E6',
            }}
          >
            {/* Previous */}
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="上一篇笔记"
              className="flex items-center gap-4 group cursor-pointer bg-transparent border-none p-0"
            >
              <div
                className="flex justify-center items-center rounded-full flex-shrink-0"
                style={{ width: '48px', height: '48px', background: '#F3F4F1' }}
              >
                <IconArrowLeft color="#27272A" />
              </div>
              <div className="inline-flex flex-col justify-start items-start">
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: '400',
                    lineHeight: '16px',
                    letterSpacing: '0.05em',
                    color: '#737373',
                    textTransform: 'uppercase',
                  }}
                >
                  PREVIOUS
                </span>
                <span
                  style={{
                    fontSize: '16px',
                    fontWeight: '700',
                    lineHeight: '24px',
                    color: '#27272A',
                  }}
                >
                  {MOCK_NOTE.prev}
                </span>
              </div>
            </button>

            {/* Next */}
            <button
              type="button"
              onClick={() => navigate(1)}
              aria-label="下一篇笔记"
              className="flex items-center gap-4 group cursor-pointer bg-transparent border-none p-0 ml-auto"
            >
              <div className="inline-flex flex-col justify-start items-end">
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: '400',
                    lineHeight: '16px',
                    letterSpacing: '0.05em',
                    color: '#737373',
                    textTransform: 'uppercase',
                  }}
                >
                  NEXT
                </span>
                <span
                  style={{
                    fontSize: '16px',
                    fontWeight: '700',
                    lineHeight: '24px',
                    color: '#27272A',
                    textAlign: 'right',
                  }}
                >
                  {MOCK_NOTE.next}
                </span>
              </div>
              <div
                className="flex justify-center items-center rounded-full flex-shrink-0"
                style={{ width: '48px', height: '48px', background: '#F3F4F1' }}
              >
                <IconArrowRight color="#27272A" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
