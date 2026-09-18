import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../auth'
import {
  VisibilityBadge, VisibilitySelect, canEdit, fmtDate,
  groupByCategory, useDragMove, useCategoryTools, CategoryHeading, CategorySelect, UNSORTED,
} from './common'

// 메모를 쓰고 저장하는 탭. 왼쪽 목록, 오른쪽 편집.
export function MemoTab({ tab, items }) {
  const { profile, isAdmin } = useAuth()
  const [selectedId, setSelectedId] = useState(null)
  const drag = useDragMove(items, profile, tab)
  const cat = useCategoryTools(tab, isAdmin)
  const groups = groupByCategory(items, tab).filter(([c, list]) => list.length || c !== UNSORTED || isAdmin)
  const selected = items.find((m) => m.id === selectedId) || null

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [category, setCategory] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')

  // 선택한 메모가 바뀌면 편집칸 내용을 맞춰줍니다.
  useEffect(() => {
    if (selected) {
      setTitle(selected.title || '')
      setContent(selected.content || '')
      setVisibility(selected.visibility || 'private')
      setCategory(selected.category || '')
    } else {
      setTitle('')
      setContent('')
      setVisibility('private')
      setCategory('')
    }
    setDirty(false)
    setStatus('')
  }, [selectedId]) // eslint-disable-line

  const mark = (fn) => (v) => {
    fn(v)
    setDirty(true)
  }

  const save = async () => {
    if (!title.trim() && !content.trim()) return
    setStatus('저장 중…')
    const data = { title: title.trim() || '제목 없음', content, visibility, category, updatedAt: serverTimestamp() }
    if (selected) {
      await updateDoc(doc(db, 'items', selected.id), data)
    } else {
      const refDoc = await addDoc(collection(db, 'items'), {
        ...data,
        type: 'memo',
        tabId: tab.id,
        order: Date.now() / 1000,
        ownerUid: profile.uid,
        ownerName: profile.name || profile.email,
        createdAt: serverTimestamp(),
      })
      setSelectedId(refDoc.id)
    }
    setDirty(false)
    setStatus('저장됨 ✓')
  }

  const remove = async () => {
    if (!selected) return
    if (!confirm(`'${selected.title}' 메모를 삭제할까요?`)) return
    await deleteDoc(doc(db, 'items', selected.id))
    setSelectedId(null)
  }

  const editable = !selected || canEdit(selected, profile)

  return (
    <>
      <div className="page-title">
        <div>
          <h1>{tab.name}</h1>
          <p>{tab.tip || '메모는 기본으로 나만 볼 수 있어요. 공개범위를 바꾸면 다른 사람에게도 보여요.'}</p>
        </div>
        <div className="row">
          {cat.button}
          <button className="btn" onClick={() => setSelectedId(null)} data-tip="빈 메모 새로 쓰기">
            ＋ 새 메모
          </button>
        </div>
      </div>

      <div className="memo-layout">
        <div className="memo-list">
          {items.length === 0 && !(tab.categories || []).length && <div className="empty">메모가 없어요.</div>}
          {groups.map(([c, list]) => (
            <section key={c} className="cat-section" data-cat={c} {...drag.sectionProps(c, list)}>
              <CategoryHeading cat={c} onEdit={cat.open} onRename={cat.rename} handleProps={isAdmin ? drag.handleProps : null} />
              {list.map((m) => (
                <div
                  key={m.id}
                  className={`memo-item ${selectedId === m.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(m.id)}
                  data-tip={`분류: ${m.category || UNSORTED}`}
                  {...drag.cardProps(m, c, list)}
                >
                  <div className="t">{m.title || '제목 없음'}</div>
                  <div className="d">
                    <span>{fmtDate(m.updatedAt || m.createdAt)}</span>
                    <VisibilityBadge value={m.visibility} />
                  </div>
                </div>
              ))}
              {list.length === 0 && <div className="drop-hint">여기로 끌어오세요</div>}
            </section>
          ))}
        </div>

        <div className="card">
          <input
            className="input memo-title-input"
            placeholder="제목"
            value={title}
            onChange={(e) => mark(setTitle)(e.target.value)}
            readOnly={!editable}
          />
          <textarea
            className="textarea memo-body"
            placeholder="여기에 메모를 적으세요…"
            value={content}
            onChange={(e) => mark(setContent)(e.target.value)}
            readOnly={!editable}
          />
          <div className="row between">
            <div className="row">
              {editable ? (
                <>
                  <div style={{ width: 170 }}>
                    <VisibilitySelect value={visibility} onChange={mark(setVisibility)} />
                  </div>
                  <div style={{ width: 150 }} data-tip="분류 (주제)">
                    <CategorySelect value={category} onChange={mark(setCategory)} tab={tab} />
                  </div>
                </>
              ) : (
                <span className="hint">{selected?.ownerName}님의 메모 (읽기만 가능)</span>
              )}
              <span className="hint">{status}</span>
            </div>
            {editable && (
              <div className="row">
                {selected && (
                  <button className="btn danger sm" onClick={remove}>
                    삭제
                  </button>
                )}
                <button className="btn" onClick={save} disabled={!dirty && !!selected}>
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {cat.modal}
    </>
  )
}
