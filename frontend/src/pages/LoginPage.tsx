import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { API_BASE } from '../lib/api'

const ERROR_MAP: Record<string, string> = {
  google_oauth_failed: 'Google 登录失败，请重试。',
  not_allowed: '当前账号不在邀请白名单中。',
}

export default function LoginPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true })
    }
  }, [loading, navigate, user])

  const params = new URLSearchParams(location.search)
  const error = params.get('error')
  const errorText = error ? (ERROR_MAP[error] ?? '登录失败，请稍后重试。') : null

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at top left, rgba(121,140,0,0.14), transparent 32%), #F5F3EC',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#FFFFFF',
          borderRadius: '24px',
          boxShadow: '0 24px 60px rgba(47,51,49,0.10)',
          padding: '36px',
        }}
      >
        <div style={{ fontSize: '30px', fontWeight: 800, color: '#2F3331', marginBottom: '10px' }}>
          LiberStudy
        </div>
        <p style={{ fontSize: '14px', color: '#72726E', lineHeight: 1.7, margin: '0 0 24px' }}>
          当前版本为作品展示环境。打开公开访客模式后，访问者会自动进入真实产品；团队成员也可以继续使用 Google 登录。
        </p>

        {errorText && (
          <div
            style={{
              marginBottom: '16px',
              padding: '12px 14px',
              borderRadius: '12px',
              background: '#FFF4F2',
              color: '#B45309',
              fontSize: '13px',
              lineHeight: 1.6,
            }}
          >
            {errorText}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            window.location.href = `${API_BASE}/api/auth/google/login`
          }}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: '9999px',
            background: '#2F3331',
            color: '#FFFFFF',
            padding: '14px 18px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          使用 Google 登录
        </button>
      </div>
    </div>
  )
}
