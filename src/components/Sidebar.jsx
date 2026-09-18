import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../auth'
import { Modal, VisibilitySelect, VISIBILITY } from './common'
import { SITE_NAME } from '../legal'

// 탭 종류: links(링크 모음) / files(파일 모음) / html(웹앱) / memo(메모)
export const TAB_TYPES = {
  links: { label: '링크 모음', icon: '🔗', tip: '사진 + 제목으로 링크를 모아두는 탭' },
  files: { label: '파일 모음', icon: '📁', tip: '어떤 파일이든 올려 두고 내려받는 탭' },
  html: { label: '웹앱', icon: '🧩', tip: 'HTML 파일을 올리면 그대로 실행되는 탭' },
  memo: { label: '메모', icon: '📝', tip: '메모를 쓰고 저장하는 탭' },
}

// 탭에 마우스를 올리면 뜨는 안내 창: 설명 + 분류별 자료 개수. 분류를 누르면 그 자리로 이동합니다.
function catCounts(t, items) {
  const counts = new Map()
  for (const c of t.categories || []) counts.set(c, 0)
  for (const it of items.filter((it) => it.tabId === t.id)) {
    const k = (it.category || '').trim() || '미분류'
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  return [...counts.entries()]
}
function NavPop({ tab, items, onGoto }) {
  const rows = catCounts(tab, items)
  return (
    <div className="nav-pop" onClick={(e) => e.stopPropagation()}>
      <div className="nav-pop-tip">{tab.tip || TAB_TYPES[tab.type]?.tip || tab.name}</div>
      {rows.length === 0 && <div className="nav-pop-empty">분류 없음</div>}
      {rows.map(([c, n]) => (
        <button key={c} className="nav-pop-row" onClick={() => onGoto(tab.id, c)} title={`'${c}' 칸으로 이동`}>
          <span>{c}</span>
        </button>
      ))}
    </div>
  )
}

export function Sidebar({ tabs, items = [], activeId, onSelect, onGoto }) {
  const { profile, isAdmin, logout } = useAuth()
  const [editing, setEditing] = useState(null) // null | 'new' | tab 객체

  const removeTab = async (tab) => {
    if (!confirm(`'${tab.name}' 탭을 삭제할까요? 탭 안의 자료는 남아있지만 보이지 않게 됩니다.`)) return
    await deleteDoc(doc(db, 'tabs', tab.id))
    if (activeId === tab.id) onSelect(tabs[0]?.id || null)
  }

  return (
    <aside className="sidebar">
      <div className="brand">{SITE_NAME}</div>
      <nav className="nav">
        <div
          role="button"
          tabIndex={0}
          className={`nav-item ${activeId === '__home' ? 'active' : ''}`}
          onClick={() => onSelect('__home')}
          onKeyDown={(e) => e.key === 'Enter' && onSelect('__home')}
          data-tip="학사일정 달력 (첫 화면)"
        >
          <span className="nav-icon">📅</span>
          <span className="nav-label">학사일정</span>
        </div>
        {tabs.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            className={`nav-item ${activeId === t.id ? 'active' : ''}`}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(t.id)}
          >
            <span className="nav-icon">{t.icon || TAB_TYPES[t.type]?.icon}</span>
            <span className="nav-label">{t.name}</span>
            <NavPop tab={t} items={items} onGoto={onGoto} />
            {isAdmin && (
              <span
                role="button"
                className="btn ghost sm"
                style={{ padding: '2px 6px', color: 'inherit', opacity: 0.6 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing(t)
                }}
              >
                ✎
              </span>
            )}
          </div>
        ))}
        {isAdmin && (
          <>
            <div className="nav-divider" />
            <button className="nav-item" onClick={() => setEditing('new')} data-tip="새 탭을 왼쪽 메뉴에 추가">
              <span className="nav-icon">＋</span>
              <span className="nav-label">탭 추가</span>
            </button>
            <button
              className={`nav-item ${activeId === '__admin' ? 'active' : ''}`}
              onClick={() => onSelect('__admin')}
              data-tip="이용자 승인·관리"
            >
              <span className="nav-icon">🛡️</span>
              <span className="nav-label">관리자</span>
            </button>
          </>
        )}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user" data-tip={profile?.email}>
          {profile?.photo && <img src={profile.photo} alt="" referrerPolicy="no-referrer" />}
          <span>{profile?.name || profile?.email}</span>
        </div>
        <button className="btn ghost sm" style={{ color: 'inherit' }} onClick={logout}>
          로그아웃
        </button>
      </div>

      {editing && (
        <TabEditor
          tab={editing === 'new' ? null : editing}
          order={tabs.length}
          onClose={() => setEditing(null)}
          onDelete={editing !== 'new' ? () => removeTab(editing).then(() => setEditing(null)) : null}
        />
      )}
    </aside>
  )
}

function TabEditor({ tab, order, onClose, onDelete }) {
  const [name, setName] = useState(tab?.name || '')
  const [type, setType] = useState(tab?.type || 'links')
  const [icon, setIcon] = useState(tab?.icon || '')
  const [tip, setTip] = useState(tab?.tip || '')
  const [visibility, setVisibility] = useState(tab?.visibility || 'approved')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const data = { name: name.trim(), type, icon: icon.trim(), tip: tip.trim(), visibility }
    if (tab) await updateDoc(doc(db, 'tabs', tab.id), data)
    else await addDoc(collection(db, 'tabs'), { ...data, order, createdAt: serverTimestamp() })
    setSaving(false)
    onClose()
  }

  return (
    <Modal
      title={tab ? '탭 수정' : '새 탭 추가'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              삭제
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
          <button className="btn" onClick={save} disabled={saving || !name.trim()}>
            저장
          </button>
        </>
      }
    >
      <div className="field">
        <label>탭 이름</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 수업 자료" />
      </div>
      <div className="field">
        <label>탭 종류</label>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} disabled={!!tab}>
          {Object.entries(TAB_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.icon} {v.label} — {v.tip}
            </option>
          ))}
        </select>
        {tab && <span className="hint">탭 종류는 만든 뒤에 바꿀 수 없어요.</span>}
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>아이콘(이모지, 선택)</label>
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="📚" />
        </div>
        <div className="field" style={{ flex: 3 }}>
          <label>마우스를 올리면 보일 설명(선택)</label>
          <input className="input" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="이 탭이 무엇인지 한 줄" />
        </div>
      </div>
      <div className="field">
        <label>탭 공개범위</label>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
        <span className="hint">
          {VISIBILITY[visibility].label}: 탭 자체가 이 범위의 사람에게만 보여요. 탭 안의 자료는 각각 따로 공개범위를 정합니다.
        </span>
      </div>
    </Modal>
  )
}
