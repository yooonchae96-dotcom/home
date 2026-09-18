import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../auth'
import {
  Modal, VisibilityBadge, VisibilitySelect, canEdit, fmtDate,
  groupByCategory, useDragMove, useCategoryTools, CategoryHeading, CategorySelect, UNSORTED,
} from './common'

const MAX_HTML = 900 * 1024 // Firestore 문서 1MB 제한 안에서 넉넉하게

// HTML 파일을 올리면 그 파일이 페이지 전체로 실행되는 탭
export function HtmlTab({ tab, items }) {
  const { profile, isAdmin } = useAuth()
  const [adding, setAdding] = useState(false)
  const [running, setRunning] = useState(null)
  const drag = useDragMove(items, profile, tab)
  const cat = useCategoryTools(tab, isAdmin)
  const groups = groupByCategory(items, tab).filter(([c, list]) => list.length || c !== UNSORTED || isAdmin)

  const remove = async (item) => {
    if (!confirm(`'${item.title}' 웹앱을 삭제할까요?`)) return
    await deleteDoc(doc(db, 'items', item.id))
  }

  if (running) return <AppRunner item={running} onBack={() => setRunning(null)} />

  return (
    <>
      <div className="page-title">
        <div>
          <h1>{tab.name}</h1>
          <p>{tab.tip || 'HTML 파일을 올리면 이 페이지에서 바로 실행돼요. 끌어서 순서나 분류를 바꿀 수 있어요.'}</p>
        </div>
        <div className="row">
          {cat.button}
          {isAdmin && (
            <button className="btn" onClick={() => setAdding(true)} data-tip="HTML 파일 업로드">
              ＋ HTML 올리기
            </button>
          )}
        </div>
      </div>

      {items.length === 0 && !(tab.categories || []).length ? (
        <div className="empty">아직 올라온 웹앱이 없어요.</div>
      ) : (
        groups.map(([c, list]) => (
        <section key={c} className="cat-section" data-cat={c} {...drag.sectionProps(c, list)}>
          <CategoryHeading cat={c} onEdit={cat.open} onRename={cat.rename} handleProps={isAdmin ? drag.handleProps : null} />
          <div className="list">
          {list.map((it) => (
            <div className="list-item" key={it.id} {...drag.cardProps(it, c, list)} data-tip={`분류: ${it.category || UNSORTED}`}>
              <span style={{ fontSize: 22 }}>🧩</span>
              <div className="grow">
                <div className="name">{it.title}</div>
                <div className="sub">
                  {it.fileName} · {Math.round((it.size || 0) / 1024)}KB · {fmtDate(it.createdAt)}
                </div>
              </div>
              <VisibilityBadge value={it.visibility} />
              <button className="btn secondary sm" onClick={() => setRunning(it)} data-tip="이 페이지에서 실행">
                실행
              </button>
              {canEdit(it, profile) && (
                <button className="btn ghost sm" onClick={() => remove(it)} data-tip="삭제">
                  🗑
                </button>
              )}
            </div>
          ))}
          {list.length === 0 && <div className="drop-hint">여기로 끌어오세요</div>}
          </div>
        </section>
        ))
      )}

      {cat.modal}
      {adding && <HtmlUploader tab={tab} onClose={() => setAdding(false)} />}
    </>
  )
}

function AppRunner({ item, onBack }) {
  return (
    <div className="app-frame-wrap">
      <div className="app-frame-bar">
        <button className="btn secondary sm" onClick={onBack}>
          ← 목록으로
        </button>
        <span className="name">{item.title}</span>
        <button
          className="btn ghost sm"
          data-tip="새 창에서 크게 열기"
          onClick={() => {
            const w = window.open('', '_blank')
            if (w) {
              w.document.open()
              w.document.write(item.html)
              w.document.close()
            }
          }}
        >
          ↗ 새 창
        </button>
      </div>
      <iframe
        className="app-frame"
        title={item.title}
        srcDoc={item.html}
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
      />
    </div>
  )
}

function HtmlUploader({ tab, onClose }) {
  const { profile } = useAuth()
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [visibility, setVisibility] = useState('approved')
  const [category, setCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const onFile = (f) => {
    setFile(f)
    if (f && !title) setTitle(f.name.replace(/\.html?$/i, ''))
  }

  const save = async () => {
    setErr('')
    if (!file) return setErr('HTML 파일을 골라 주세요.')
    if (!/\.html?$/i.test(file.name)) return setErr('.html 파일만 올릴 수 있어요.')
    if (file.size > MAX_HTML) return setErr('HTML 파일은 900KB 이하만 올릴 수 있어요. (이미지는 파일 안에 넣지 말고 링크로 넣어 주세요)')
    setSaving(true)
    try {
      const html = await file.text()
      await addDoc(collection(db, 'items'), {
        type: 'html',
        tabId: tab.id,
        title: title.trim() || file.name,
        fileName: file.name,
        size: file.size,
        html,
        visibility,
        category,
        order: Date.now() / 1000,
        ownerUid: profile.uid,
        ownerName: profile.name || profile.email,
        createdAt: serverTimestamp(),
      })
      onClose()
    } catch (e) {
      setErr(e.message || '업로드에 실패했어요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="HTML 파일 올리기"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? '올리는 중…' : '올리기'}</button>
        </>
      }
    >
      <div className="field">
        <label>HTML 파일</label>
        <input className="file-input" type="file" accept=".html,.htm" onChange={(e) => onFile(e.target.files?.[0] || null)} />
      </div>
      <div className="field">
        <label>표시 이름</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 영어 듣기 반복 플레이어" />
      </div>
      <div className="field">
        <label>분류 (주제)</label>
        <CategorySelect value={category} onChange={setCategory} tab={tab} />
      </div>
      <div className="field">
        <label>공개범위</label>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
      </div>
      {err && <p className="error">{err}</p>}
    </Modal>
  )
}
