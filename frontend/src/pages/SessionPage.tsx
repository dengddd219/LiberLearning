export default function SessionPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">LiberStudy</h1>
        <p className="text-gray-600 mb-8">上课采集界面 - 实时录音 + PPT + 就地批注</p>
        <div className="space-x-4">
          <button className="px-6 py-3 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors">
            开始录音
          </button>
          <button className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            上传 PPT
          </button>
        </div>
      </div>
    </div>
  )
}
