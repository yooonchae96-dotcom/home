import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../auth'
import { LegalLinks } from './common'
import { SITE_NAME } from '../legal'

export function LoginPage() {
  const { login } = useAuth()
  const [agree, setAgree] = useState(false)
  const [err, setErr] = useState('')

  const onLogin = async () => {
    setErr('')
    try {
      await login()
    } catch (e) {
      setErr('로그인에 실패했어요. 팝업 차단을 해제하고 다시 시도해 주세요.')
    }
  }

  return (
    <div className="center-screen">
      <div className="center-card">
        <h1>{SITE_NAME}</h1>
        <p>관리자가 승인한 사람만 이용할 수 있는 공간이에요.</p>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            이용약관과 개인정보처리방침을 읽었고 동의합니다.
            <br />
            <LegalLinks />
          </span>
        </label>
        <button className="btn lg block" disabled={!agree} onClick={onLogin}>
          구글 계정으로 로그인
        </button>
        {err && <p className="error" style={{ marginTop: 12 }}>{err}</p>}
      </div>
    </div>
  )
}

// 승인 대기 화면. '전체 공개'로 설정된 자료만 미리 볼 수 있어요.
export function PendingPage() {
  const { profile, logout } = useAuth()
  const [pub, setPub] = useState([])
  const [running, setRunning] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'items'), where('visibility', '==', 'public'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, (s) => setPub(s.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  if (running) {
    return (
      <div className="app-frame-wrap">
        <div className="app-frame-bar">
          <button className="btn secondary sm" onClick={() => setRunning(null)}>← 돌아가기</button>
          <span className="name">{running.title}</span>
        </div>
        <iframe className="app-frame" title={running.title} srcDoc={running.html} sandbox="allow-scripts allow-forms allow-popups allow-modals" />
      </div>
    )
  }

  return (
    <div className="center-screen" style={{ justifyContent: 'flex-start', paddingTop: 60 }}>
      <div className="center-card">
        <h1>승인을 기다리는 중</h1>
        <p>
          <b>{profile?.email}</b> 계정으로 로그인했어요.
          <br />
          관리자가 승인하면 홈페이지 전체를 볼 수 있어요.
        </p>
        <button className="btn secondary block" onClick={logout}>
          다른 계정으로 로그인
        </button>
      </div>

      {pub.length > 0 && (
        <div style={{ width: '100%', maxWidth: 900, marginTop: 32 }}>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>🌐 전체 공개 자료</h3>
          <div className="grid wide">
            {pub.map((it) =>
              it.type === 'link' ? (
                <a className="link-card" key={it.id} href={it.url} target="_blank" rel="noreferrer">
                  {it.imageUrl ? <img className="thumb" src={it.imageUrl} alt="" /> : <div className="thumb placeholder">🔗</div>}
                  <div className="title">{it.title}</div>
                </a>
              ) : it.type === 'html' ? (
                <div className="link-card" key={it.id} onClick={() => setRunning(it)} style={{ cursor: 'pointer' }}>
                  <div className="thumb placeholder">🧩</div>
                  <div className="title">{it.title}</div>
                </div>
              ) : (
                <div className="card" key={it.id} style={{ gridColumn: '1 / -1' }}>
                  <b style={{ color: 'var(--navy)' }}>📝 {it.title}</b>
                  <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', fontSize: 14 }}>{it.content}</p>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function LoadingPage() {
  return (
    <div className="center-screen">
      <div className="center-card">
        <p style={{ margin: 0 }}>불러오는 중…</p>
      </div>
    </div>
  )
}
