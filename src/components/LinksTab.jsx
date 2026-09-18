import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { useAuth } from '../auth'
import {
  Modal, VisibilityBadge, VisibilitySelect, canEdit,
  groupByCategory, useDragMove, useCategoryTools, CategoryHeading, CategorySelect, UNSORTED,
} from './common'

// 사진이 위, 제목이 아래에 뜨는 링크 카드 모음. 분류별로 묶이고, 카드를 끌어서 옮길 수 있어요.
export function LinksTab({ tab, items }) {
  const { profile, isAdmin } = useAuth()
  const [editing, setEditing] = useState(null) // null | 'new' | item
  const drag = useDragMove(items, profile, tab)
  const cat = useCategoryTools(tab, isAdmin)

  const remove = async (item) => {
    if (!confirm(`'${item.title}' 링크를 삭제할까요?`)) return
    await deleteDoc(doc(db, 'items', item.id))
  }

  const groups = groupByCategory(items, tab).filter(([c, list]) => list.length || c !== UNSORTED || isAdmin)

  return (
    <>
      <div className="page-title">
        <div>
          <h1>{tab.name}</h1>
          <p>{tab.tip || '카드를 누르면 새 창에서 링크가 열려요. 카드를 끌어서 위치나 분류를 바꿀 수 있어요.'}</p>
        </div>
        <div className="row">
          {cat.button}
          {isAdmin && (
            <button className="btn" onClick={() => setEditing('new')} data-tip="제목·주소·사진을 넣어 링크 카드 만들기">
              ＋ 링크 추가
            </button>
          )}
        </div>
      </div>

      {items.length === 0 && !(tab.categories || []).length ? (
        <div className="empty">아직 등록된 링크가 없어요.</div>
      ) : (
        groups.map(([c, list]) => (
          <section key={c} className="cat-section" data-cat={c} {...drag.sectionProps(c, list)}>
            <CategoryHeading cat={c} onEdit={cat.open} onRename={cat.rename} handleProps={isAdmin ? drag.handleProps : null} />
            <div className="grid">
              {list.map((it) => (
                <div className="link-card" key={it.id} {...drag.cardProps(it, c, list)}>
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noreferrer"
                    data-tip={`${it.category || UNSORTED} · ${it.url}`}
                    onClick={(e) => drag.dragging && e.preventDefault()}
                  >
                    {it.imageUrl ? <img className="thumb" src={it.imageUrl} alt="" draggable={false} /> : <div className="thumb placeholder">🔗</div>}
                    <div className="title">{it.title}</div>
                  </a>
                  <div className="meta">
                    <VisibilityBadge value={it.visibility} compact />
                    {canEdit(it, profile) && (
                      <div className="actions">
                        <button className="btn ghost sm" onClick={() => setEditing(it)} data-tip="수정">✎</button>
                        <button className="btn ghost sm" onClick={() => remove(it)} data-tip="삭제">🗑</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {list.length === 0 && <div className="drop-hint">여기로 카드를 끌어오세요</div>}
            </div>
          </section>
        ))
      )}

      {cat.modal}
      {editing && <LinkEditor tab={tab} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function LinkEditor({ tab, item, onClose }) {
  const { profile } = useAuth()
  const [title, setTitle] = useState(item?.title || '')
  const [url, setUrl] = useState(item?.url || '')
  const [category, setCategory] = useState(item?.category || '')
  const [visibility, setVisibility] = useState(item?.visibility || 'approved')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setErr('')
    if (!title.trim() || !url.trim()) return setErr('제목과 링크 주소는 꼭 넣어 주세요.')
    let fullUrl = url.trim()
    if (!/^https?:\/\//i.test(fullUrl)) fullUrl = 'https://' + fullUrl
    setSaving(true)
    try {
      let imageUrl = item?.imageUrl || ''
      if (file) {
        if (!file.type.startsWith('image/')) throw new Error('이미지 파일(jpg, png 등)만 올릴 수 있어요.')
        if (file.size > 5 * 1024 * 1024) throw new Error('사진은 5MB 이하로 올려 주세요.')
        const path = `images/${profile.uid}/${Date.now()}_${file.name}`
        const snap = await uploadBytes(ref(storage, path), file)
        imageUrl = await getDownloadURL(snap.ref)
      }
      const data = { title: title.trim(), url: fullUrl, imageUrl, category, visibility, updatedAt: serverTimestamp() }
      if (item) await updateDoc(doc(db, 'items', item.id), data)
      else
        await addDoc(collection(db, 'items'), {
          ...data,
          type: 'link',
          tabId: tab.id,
          order: Date.now() / 1000,
          ownerUid: profile.uid,
          ownerName: profile.name || profile.email,
          createdAt: serverTimestamp(),
        })
      onClose()
    } catch (e) {
      setErr(e.message || '저장에 실패했어요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={item ? '링크 수정' : '링크 추가'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </>
      }
    >
      <div className="field">
        <label>링크 제목</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 학급 패들렛" />
      </div>
      <div className="field">
        <label>링크 주소</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
      </div>
      <div className="field">
        <label>분류 (주제)</label>
        <CategorySelect value={category} onChange={setCategory} tab={tab} />
        <span className="hint">분류는 탭 화면의 '＋ 분류 추가'로 만들어요. 나중에 카드를 끌어서 옮길 수도 있어요.</span>
      </div>
      <div className="field">
        <label>사진 (jpg, jpeg, png 등)</label>
        <input className="file-input" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {item?.imageUrl && !file && <span className="hint">새 사진을 고르지 않으면 지금 사진이 유지돼요.</span>}
      </div>
      <div className="field">
        <label>공개범위</label>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
      </div>
      {err && <p className="error">{err}</p>}
    </Modal>
  )
}
