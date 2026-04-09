interface SlideThumb {
  pageNum: number
  slideImageUrl: string
}

interface OutlineNavProps {
  slides: SlideThumb[]
  currentPage: number
  onPageClick: (pageNum: number) => void
}

export default function OutlineNav({ slides, currentPage, onPageClick }: OutlineNavProps) {
  return (
    <nav className="p-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-2">大纲</p>
      <ul className="space-y-1">
        {slides.map((slide) => (
          <li key={slide.pageNum}>
            <button
              onClick={() => onPageClick(slide.pageNum)}
              className={`group relative w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                currentPage === slide.pageNum
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              第 {slide.pageNum} 页
              {/* Hover thumbnail */}
              <div className="absolute left-full top-0 ml-2 z-50 hidden group-hover:block">
                <img
                  src={slide.slideImageUrl}
                  alt={`第${slide.pageNum}页预览`}
                  className="w-48 rounded shadow-lg border border-gray-200"
                />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
