import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SlideCanvas from '../components/SlideCanvas'
import RecordingControl from '../components/RecordingControl'
import FileUpload from '../components/FileUpload'

interface Annotation {
  id: string
  pageNum: number
  text: string
  yPosition: number
  timestamp: number
}

interface SlideInfo {
  pageNum: number
  slideImageUrl: string
}

const SESSION_ID = `session-${Date.now()}`

// Mock slides - replace with real PPT slides when uploaded
const MOCK_SLIDES: SlideInfo[] = [
  { pageNum: 1, slideImageUrl: '/slides/slide_001.png' },
  { pageNum: 2, slideImageUrl: '/slides/slide_002.png' },
  { pageNum: 3, slideImageUrl: '/slides/slide_003.png' },
]

function useRecordingTimer(isRecording: boolean) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isRecording])

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function LiveSessionPage() {
  const navigate = useNavigate()
  const [slides] = useState<SlideInfo[]>(MOCK_SLIDES)
  const [currentPage, setCurrentPage] = useState(1)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [hasPpt, setHasPpt] = useState(true) // Toggle this based on PPT upload state
  const [isRecording, setIsRecording] = useState(false)
  const [noteMode, setNoteMode] = useState<'my' | 'ai'>('ai')
  const [noteInput, setNoteInput] = useState('')
  const recTimer = useRecordingTimer(isRecording)
  const totalPages = slides.length

  const handleAnnotationAdd = useCallback((ann: Annotation) => {
    setAnnotations((prev) => [...prev, ann])
  }, [])

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const handleNavClick = useCallback((pageNum: number) => {
    setScrollToPage(pageNum)
    setTimeout(() => setScrollToPage(null), 100)
  }, [])

  const handlePptUpload = useCallback((file: File) => {
    setPptFile(file)
    setHasPpt(true)
  }, [])

  const handleStartRecording = useCallback(() => {
    setIsRecording(true)
  }, [])

  const handleEndSession = useCallback(() => {
    setIsRecording(false)
    navigate('/notes/mock-session-001')
  }, [navigate])

  // Mock notes for display
  const mockNotes = [
    {
      id: '1',
      timestamp: '00:45',
      title: 'Contextual Anchors',
      content: 'Discussing how neural networks bridge the gap between abstract symbolic reasoning and raw data input.',
      isActive: false,
    },
    {
      id: '2',
      timestamp: '03:52',
      title: 'Latency vs Throughput',
      content: 'Critical bottleneck identified in the pre-processing layer.\nReal-time capture requires 4ms response time.\nPossible solution: Distributed nodes.',
      isActive: true,
    },
  ]

  return (
    <div
      className="w-[1519px] pb-24 relative bg-stone-50 inline-flex flex-col justify-start items-start"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      {/* Main content area */}
      <div className="self-stretch h-[1024px] pt-16 inline-flex justify-start items-start overflow-hidden">
        {/* Left sidebar - Lecture Slides */}
        <div className="w-48 self-stretch bg-stone-100 border-r border-zinc-400/10 inline-flex flex-col justify-start items-start">
          <div className="self-stretch p-4 border-b border-zinc-400/10 inline-flex justify-between items-center">
            <div className="inline-flex flex-col justify-start items-start">
              <div className="justify-center text-slate-600 text-[10px] font-bold font-['Inter'] uppercase leading-4 tracking-wide">LECTURE SLIDES</div>
            </div>
            <div className="inline-flex flex-col justify-center items-center">
              <div className="w-3.5 h-3 bg-slate-600" />
            </div>
          </div>
          <div className="self-stretch flex-1 p-3 flex flex-col justify-start items-start gap-4 overflow-hidden">
            {/* Slide 1 - Active */}
            <div
              className="self-stretch relative bg-white/0 rounded-md shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] shadow-[0px_0px_0px_2px_rgba(95,94,94,1.00)] flex flex-col justify-start items-start overflow-hidden"
              onClick={() => handleNavClick(1)}
            >
              <img className="self-stretch h-24 relative" src="https://placehold.co/175x96" alt="Slide 1" />
              <div className="px-1.5 left-[4px] top-[4px] absolute bg-zinc-600 rounded-sm flex flex-col justify-start items-start">
                <div className="justify-center text-white text-[10px] font-normal font-['Inter'] leading-4">01</div>
              </div>
            </div>
            {/* Slide 2 - Inactive */}
            <div
              className="self-stretch relative opacity-70 bg-gray-200 rounded-md flex flex-col justify-start items-start overflow-hidden"
              onClick={() => handleNavClick(2)}
            >
              <div className="self-stretch h-24 relative bg-blend-saturation bg-white" />
              <div className="px-1.5 left-[4px] top-[4px] absolute bg-slate-600 rounded-sm flex flex-col justify-start items-start">
                <div className="justify-center text-white text-[10px] font-normal font-['Inter'] leading-4">02</div>
              </div>
            </div>
            {/* Slide 3 - Inactive */}
            <div
              className="self-stretch relative opacity-70 bg-gray-200 rounded-md flex flex-col justify-start items-start overflow-hidden"
              onClick={() => handleNavClick(3)}
            >
              <div className="self-stretch h-24 relative bg-blend-saturation bg-white" />
              <div className="px-1.5 left-[4px] top-[4px] absolute bg-slate-600 rounded-sm flex flex-col justify-start items-start">
                <div className="justify-center text-white text-[10px] font-normal font-['Inter'] leading-4">03</div>
              </div>
            </div>
          </div>
        </div>

        {/* Center - PPT Canvas */}
        <div className="flex-1 self-stretch bg-stone-50 inline-flex flex-col justify-start items-start overflow-hidden">
          {/* Toolbar */}
          <div className="self-stretch h-12 px-6 bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] border-b border-zinc-400/20 inline-flex justify-between items-center">
            <div className="flex justify-start items-center gap-4">
              <div className="flex justify-start items-center gap-2">
                <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                  <div className="w-4 h-4 bg-slate-600" />
                </div>
                <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                  <div className="w-4 h-4 bg-slate-600" />
                </div>
              </div>
              <div className="w-px h-6 bg-zinc-400/20" />
              <div className="flex justify-start items-center gap-2">
                <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                  <div className="w-5 h-4 bg-slate-600" />
                </div>
                <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                  <div className="w-5 h-4 bg-slate-600" />
                </div>
                <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                  <div className="w-3.5 h-4 bg-slate-600" />
                </div>
              </div>
            </div>
            <div className="flex justify-start items-center gap-3">
              <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                <div className="w-3.5 h-0.5 bg-slate-600" />
              </div>
              <div className="inline-flex flex-col justify-start items-start">
                <div className="justify-center text-zinc-800 text-xs font-medium font-['Inter'] leading-4">125%</div>
              </div>
              <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                <div className="w-3.5 h-3.5 bg-slate-600" />
              </div>
            </div>
            <div className="flex justify-start items-center gap-2">
              <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                <div className="w-4 h-4 bg-slate-600" />
              </div>
              <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                <div className="w-5 h-4 bg-slate-600" />
              </div>
              <div className="p-1 rounded-2xl inline-flex flex-col justify-center items-center">
                <div className="w-4 h-5 bg-slate-600" />
              </div>
            </div>
          </div>

          {/* PPT Canvas Area */}
          <div className="self-stretch flex-1 p-12 bg-stone-100/50 inline-flex justify-center items-center overflow-hidden">
            <div className="w-[896px] max-w-[896px] px-16 py-36 relative bg-white rounded-sm outline outline-1 outline-offset-[-1px] outline-zinc-400/5 inline-flex flex-col justify-center items-start">
              <div className="w-[896px] h-[506px] left-0 top-0 absolute bg-white/0 rounded-sm shadow-[0px_8px_10px_-6px_rgba(0,0,0,0.10)] shadow-xl" />
              <div className="self-stretch pb-8 flex flex-col justify-start items-start">
                <div className="self-stretch flex flex-col justify-start items-start">
                  <div className="self-stretch justify-center text-zinc-800 text-4xl font-bold font-['Inter'] leading-10">Advanced Cognitive Architectures</div>
                </div>
              </div>
              <div className="self-stretch flex flex-col justify-start items-start gap-6">
                <div className="self-stretch inline-flex justify-start items-start gap-4">
                  <div className="w-1.5 h-4 pt-2.5 inline-flex flex-col justify-start items-start">
                    <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
                  </div>
                  <div className="self-stretch inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-600 text-lg font-normal font-['Inter'] leading-7">Synthesis of symbolic and sub-symbolic processing frameworks.</div>
                  </div>
                </div>
                <div className="self-stretch inline-flex justify-start items-start gap-4">
                  <div className="w-1.5 h-4 pt-2.5 inline-flex flex-col justify-start items-start">
                    <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
                  </div>
                  <div className="self-stretch inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-600 text-lg font-normal font-['Inter'] leading-7">Integration of long-term memory structures (Declarative &amp; Procedural).</div>
                  </div>
                </div>
                <div className="self-stretch inline-flex justify-start items-start gap-4">
                  <div className="w-1.5 h-4 pt-2.5 inline-flex flex-col justify-start items-start">
                    <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
                  </div>
                  <div className="self-stretch inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-600 text-lg font-normal font-['Inter'] leading-7">Real-time meta-cognition and attention filtering mechanisms.</div>
                  </div>
                </div>
              </div>
              <div className="left-[784.30px] top-[33px] absolute flex flex-col justify-start items-start">
                <div className="justify-center text-zinc-400 text-[10px] font-bold font-['Inter'] leading-4 tracking-wide">SLIDE 04 / 24</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-80 self-stretch bg-white border-l border-zinc-400/10 inline-flex flex-col justify-between items-start">
          {/* Pill toggle */}
          <div className="self-stretch p-6 flex flex-col justify-start items-start gap-6">
            <div className="self-stretch p-1 bg-stone-100 rounded-full inline-flex justify-center items-start">
              <div className="flex-1 py-1.5 rounded-full flex justify-center items-center">
                <div className="text-center justify-center text-slate-600 text-xs font-medium font-['Inter'] leading-4">My Notes</div>
              </div>
              <div className="flex-1 py-1.5 bg-white rounded-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex justify-center items-center gap-1.5">
                <div className="inline-flex flex-col justify-start items-center">
                  <div className="w-3 h-3 bg-zinc-800" />
                </div>
                <div className="text-center justify-center text-zinc-800 text-xs font-semibold font-['Inter'] leading-4">AI Notes</div>
                <div className="inline-flex flex-col justify-start items-center">
                  <div className="w-1.5 h-1 bg-zinc-800" />
                </div>
              </div>
            </div>
          </div>

          {/* Recording section */}
          <div className="w-80 h-[968px] bg-white border-l border-zinc-400/10 flex flex-col justify-start items-start">
            <div className="self-stretch p-6 bg-gray-200 border-b border-zinc-400/10 flex flex-col justify-start items-start gap-6">
              <div className="self-stretch inline-flex justify-between items-center">
                <div className="flex justify-start items-center gap-2">
                  <div className="w-2 h-2 bg-pink-800 rounded-full" />
                  <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-800 text-sm font-bold font-['Inter'] leading-5">LIVE RECORDING</div>
                  </div>
                </div>
                <div className="inline-flex flex-col justify-start items-start">
                  <div className="justify-center text-zinc-600 text-xl font-medium font-['Liberation_Mono'] leading-7">{recTimer}</div>
                </div>
              </div>

              {/* Audio visualization bars */}
              <div className="self-stretch h-16 px-2 inline-flex justify-center items-end gap-1">
                <div className="flex-1 h-6 opacity-60 bg-zinc-600 rounded-full" />
                <div className="flex-1 h-10 bg-zinc-800 rounded-full" />
                <div className="flex-1 h-5 opacity-40 bg-zinc-600 rounded-full" />
                <div className="flex-1 h-12 bg-slate-600 rounded-full" />
                <div className="flex-1 h-9 bg-zinc-800 rounded-full" />
                <div className="flex-1 h-7 bg-slate-600 rounded-full" />
                <div className="flex-1 h-14 opacity-80 bg-zinc-600 rounded-full" />
                <div className="flex-1 h-6 bg-zinc-800 rounded-full" />
                <div className="flex-1 h-10 bg-slate-600 rounded-full" />
                <div className="flex-1 h-5 opacity-50 bg-zinc-800 rounded-full" />
                <div className="flex-1 h-11 bg-slate-600 rounded-full" />
                <div className="flex-1 h-8 bg-zinc-600 rounded-full" />
              </div>

              {/* End Session button */}
              <div
                className="self-stretch py-3 bg-zinc-800 rounded-full inline-flex justify-center items-center gap-2 cursor-pointer"
                onClick={handleEndSession}
              >
                <div className="inline-flex flex-col justify-start items-center">
                  <div className="w-3.5 h-3.5 bg-stone-50" />
                </div>
                <div className="text-center justify-center text-stone-50 text-sm font-medium font-['Inter'] leading-5">End Session</div>
              </div>
            </div>

            {/* Notes list */}
            <div className="self-stretch flex-1 p-6 flex flex-col justify-start items-start overflow-hidden">
              <div className="self-stretch pb-4 flex flex-col justify-start items-start">
                <div className="self-stretch inline-flex justify-between items-center">
                  <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-800 text-base font-bold font-['Inter'] leading-6">My Notes</div>
                  </div>
                  <div className="inline-flex flex-col justify-start items-start">
                    <div className="w-3 h-3 bg-slate-600" />
                  </div>
                </div>
              </div>

              <div className="self-stretch flex-1 pr-2 flex flex-col justify-start items-start gap-6 overflow-hidden">
                {/* Note item 1 */}
                <div className="self-stretch pl-4 relative flex flex-col justify-start items-start gap-[3.13px]">
                  <div className="self-stretch inline-flex justify-start items-center gap-2">
                    <div className="p-1 bg-gray-200 rounded-2xl inline-flex flex-col justify-start items-start">
                      <div className="justify-center text-slate-600 text-[10px] font-normal font-['Liberation_Mono'] leading-4">00:45</div>
                    </div>
                    <div className="inline-flex flex-col justify-start items-start">
                      <div className="justify-center text-zinc-800 text-xs font-semibold font-['Inter'] leading-4">Contextual Anchors</div>
                    </div>
                  </div>
                  <div className="self-stretch pb-px flex flex-col justify-start items-start">
                    <div className="self-stretch justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-6">Discussing how neural networks<br />bridge the gap between abstract<br />symbolic reasoning and raw data<br />input.</div>
                  </div>
                  <div className="w-0.5 h-28 left-0 top-0 absolute bg-zinc-600/20 rounded-full" />
                </div>

                {/* Note item 2 */}
                <div className="self-stretch pl-4 relative flex flex-col justify-start items-start gap-1">
                  <div className="self-stretch inline-flex justify-start items-center gap-2">
                    <div className="p-1 bg-zinc-600 rounded-2xl inline-flex flex-col justify-start items-start">
                      <div className="justify-center text-stone-50 text-[10px] font-normal font-['Liberation_Mono'] leading-4">03:52</div>
                    </div>
                    <div className="inline-flex flex-col justify-start items-start">
                      <div className="justify-center text-zinc-800 text-xs font-semibold font-['Inter'] leading-4">Latency vs Throughput</div>
                    </div>
                  </div>
                  <div className="self-stretch flex flex-col justify-start items-start gap-2">
                    <div className="self-stretch h-10 relative">
                      <div className="left-0 top-[-0.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter']"> </div>
                      <div className="left-[20px] top-[-0.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">Critical bottleneck identified in the</div>
                      <div className="left-0 top-[19.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">pre-processing layer.</div>
                    </div>
                    <div className="self-stretch h-10 relative">
                      <div className="left-0 top-[-0.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter']"> </div>
                      <div className="left-[20px] top-[-0.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">Real-time capture requires 4ms</div>
                      <div className="left-0 top-[19.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">response time.</div>
                    </div>
                    <div className="self-stretch h-10 relative">
                      <div className="left-0 top-[-0.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter']"> </div>
                      <div className="left-[20px] top-[-0.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">Possible solution: Distributed</div>
                      <div className="left-0 top-[19.50px] absolute justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">nodes.</div>
                    </div>
                  </div>
                  <div className="w-0.5 h-40 left-0 top-0 absolute bg-zinc-600 rounded-full" />
                </div>

                {/* AI Transcription placeholder */}
                <div className="self-stretch p-4 bg-stone-100 rounded-[48px] outline outline-1 outline-offset-[-1px] outline-zinc-400/10 flex flex-col justify-start items-start gap-2">
                  <div className="self-stretch inline-flex justify-start items-center gap-2">
                    <div className="inline-flex flex-col justify-start items-start">
                      <div className="w-3 h-3 bg-zinc-600" />
                    </div>
                    <div className="inline-flex flex-col justify-start items-start">
                      <div className="justify-center text-slate-600 text-[10px] font-bold font-['Inter'] uppercase leading-4 tracking-wide">AI TRANSCRIPTION...</div>
                    </div>
                  </div>
                  <div className="w-44 h-2 bg-zinc-400/20 rounded-full" />
                  <div className="w-28 h-2 bg-zinc-400/20 rounded-full" />
                </div>
              </div>

              {/* Input area */}
              <div className="self-stretch pt-4 flex flex-col justify-start items-start">
                <div className="self-stretch pt-4 border-t border-zinc-400/10 flex flex-col justify-start items-start">
                  <div className="self-stretch relative flex flex-col justify-start items-start">
                    <div className="self-stretch h-24 p-4 bg-stone-100 rounded-[48px] inline-flex justify-center items-start overflow-hidden">
                      <div className="flex-1 inline-flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-400 text-sm font-normal font-['Inter'] leading-5">Type a note (Alt + N)...</div>
                      </div>
                    </div>
                    <div className="left-[197.75px] top-[60px] absolute inline-flex justify-start items-start gap-2">
                      <div className="p-1.5 rounded-md inline-flex flex-col justify-center items-center">
                        <div className="inline-flex justify-center items-start">
                          <div className="w-3.5 h-2.5 bg-zinc-800" />
                        </div>
                      </div>
                      <div className="p-1.5 bg-zinc-600 rounded-md inline-flex flex-col justify-center items-center">
                        <div className="inline-flex justify-center items-start">
                          <div className="w-3.5 h-3 bg-stone-50" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="w-[1519px] h-10 px-8 left-0 top-[1084px] absolute bg-stone-50 border-t border-zinc-400/20 inline-flex justify-between items-center"
      >
        <div className="inline-flex flex-col justify-start items-start">
          <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide">© 2024 LIBERSTUDY EDITORIAL. CRAFTED FOR CLARITY.</div>
        </div>
        <div className="flex justify-start items-start gap-6">
          <div className="self-stretch inline-flex flex-col justify-start items-start">
            <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide">SUPPORT</div>
          </div>
          <div className="self-stretch inline-flex flex-col justify-start items-start">
            <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide">PRIVACY</div>
          </div>
          <div className="self-stretch inline-flex flex-col justify-start items-start">
            <div className="justify-center text-slate-600 text-[10px] font-normal font-['Inter'] uppercase leading-4 tracking-wide">TERMS</div>
          </div>
        </div>
      </div>
    </div>
  )
}
