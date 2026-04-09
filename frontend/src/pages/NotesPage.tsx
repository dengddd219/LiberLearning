import { useParams } from 'react-router-dom'

export default function NotesPage() {
  const { sessionId } = useParams<{ sessionId: string }>()

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">笔记查看</h1>
        <p className="text-gray-600">Session: {sessionId}</p>
      </div>
    </div>
  )
}
