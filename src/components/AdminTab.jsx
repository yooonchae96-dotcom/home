import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../auth'
import { fmtDate } from './common'

// 이용자 승인·관리 화면 (관리자만)
export function AdminTab() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('lastLogin', 'desc'))
    return onSnapshot(q, (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  const setStatus = (u, status) => updateDoc(doc(db, 'users', u.id), { status })
  const remove = async (u) => {
    if (!confirm(`${u.email} 이용자를 목록에서 삭제할까요? (다시 로그인하면 승인 대기로 돌아옵니다)`)) return
    await deleteDoc(doc(db, 'users', u.id))
  }

  const pending = users.filter((u) => u.status !== 'approved')
  const approved = users.filter((u) => u.status === 'approved')

  const Row = ({ u }) => (
    <div className="list-item">
      {u.photo ? (
        <img src={u.photo} alt="" referrerPolicy="no-referrer" style={{ width: 36, height: 36, borderRadius: '50%' }} />
      ) : (
        <span style={{ fontSize: 22 }}>👤</span>
      )}
      <div className="grow">
        <div className="name">
          {u.name || '(이름 없음)'} {u.role === 'admin' && <span className="badge approved">관리자</span>}
        </div>
        <div className="sub">
          {u.email} · 마지막 로그인 {fmtDate(u.lastLogin)} · 약관 {u.agreedTerms ? '동의함' : '미동의'}
        </div>
      </div>
      {u.id !== profile.uid && (
        <>
          {u.status === 'approved' ? (
            <button className="btn ghost sm" onClick={() => setStatus(u, 'pending')} data-tip="다시 볼 수 없게 하기">
              승인 취소
            </button>
          ) : (
            <button className="btn sm" onClick={() => setStatus(u, 'approved')} data-tip="홈페이지를 볼 수 있게 하기">
              승인
            </button>
          )}
          <button className="btn ghost sm" onClick={() => remove(u)} data-tip="목록에서 삭제">
            🗑
          </button>
        </>
      )}
    </div>
  )

  return (
    <>
      <div className="page-title">
        <div>
          <h1>관리자</h1>
          <p>로그인한 사람 중 승인한 사람만 홈페이지를 볼 수 있어요.</p>
        </div>
      </div>

      <h3 style={{ color: 'var(--navy)', margin: '8px 0 10px' }}>승인 대기 ({pending.length})</h3>
      <div className="list" style={{ marginBottom: 28 }}>
        {pending.length === 0 && <div className="hint">대기 중인 사람이 없어요.</div>}
        {pending.map((u) => <Row key={u.id} u={u} />)}
      </div>

      <h3 style={{ color: 'var(--navy)', margin: '8px 0 10px' }}>승인된 사람 ({approved.length})</h3>
      <div className="list">
        {approved.map((u) => <Row key={u.id} u={u} />)}
      </div>
    </>
  )
}
