import { useRef, useState } from 'react'

interface FileUploadProps {
  accept?: string
  label: string
  hint?: string
  onFile: (file: File) => void
  uploading?: boolean
  uploaded?: boolean
}

export default function FileUpload({
  accept = '.ppt,.pptx,.pdf',
  label,
  hint,
  onFile,
  uploading = false,
  uploaded = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && !uploaded && inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 transition-colors cursor-pointer
        ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}
        ${uploaded ? 'border-green-400 bg-green-50 cursor-default' : ''}
        ${uploading ? 'opacity-60 cursor-wait' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />

      {uploaded ? (
        <>
          <span className="text-2xl">✅</span>
          <p className="text-sm font-medium text-green-700">已上传</p>
        </>
      ) : uploading ? (
        <>
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">上传中…</p>
        </>
      ) : (
        <>
          <span className="text-3xl text-gray-300">📄</span>
          <p className="text-sm font-medium text-gray-600">{label}</p>
          {hint && <p className="text-xs text-gray-400">{hint}</p>}
          <p className="text-xs text-gray-400">拖拽文件或点击上传</p>
        </>
      )}
    </div>
  )
}
