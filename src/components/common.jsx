import { useState } from 'react'
import { doc, updateDoc, writeBatch, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { TERMS, PRIVACY, SITE_NAME } from '../legal'

// 공개범위 값과 표시 이름
export const VISIBILITY = {
  private: { label: '나만 보기', icon: '🔒' },
  approved: { label: '승인받은 사람만', icon: '👥' },
  public: { label: '전체 공개', icon: '🌐' },
}

export function VisibilityBadge({ value, compact }) {
  const v = VISIBILITY[value] || VISIBILITY.private
  return (
    <span className={`badge ${value}`} data-tip={`공개범위: ${v.label}`}>
      {v.icon}{compact ? '' : ` ${v.label}`}
    </span>
  )
}

export function VisibilitySelect({ value, onChange }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(VISIBILITY).map(([k, v]) => (
        <option key={k} value={k}>
          {v.icon} {v.label}
        </option>
      ))}
    </select>
  )
}

// 현재 사용자가 이 항목을 볼 수 있는가?
export function canSee(item, profile) {
  if (!item) return false
  if (item.visibility === 'public') return true
  if (!profile) return false
  if (profile.role === 'admin') return true
  if (item.ownerUid === profile.uid) return true
  if (item.visibility === 'approved') return profile.status === 'approved'
  return false
}

export function canEdit(item, profile) {
  if (!profile) return false
  return profile.role === 'admin' || item.ownerUid === profile.uid
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="btn ghost sm" onClick={onClose} data-tip="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

function LegalBody({ items }) {
  return items.map(([h, p]) => (
    <div key={h}>
      <h4>{h}</h4>
      <p>{p}</p>
    </div>
  ))
}

// 약관·개인정보 처리방침 모달을 여는 링크 두 개 (푸터·로그인 화면 공용)
export function LegalLinks({ className = '' }) {
  const [open, setOpen] = useState(null)
  return (
    <>
      <button className={`link-btn ${className}`} onClick={() => setOpen('terms')}>
        이용약관
      </button>
      <button className={`link-btn ${className}`} onClick={() => setOpen('privacy')}>
        개인정보처리방침
      </button>
      {open === 'terms' && (
        <Modal title="이용약관" onClose={() => setOpen(null)}>
          <LegalBody items={TERMS} />
        </Modal>
      )}
      {open === 'privacy' && (
        <Modal title="개인정보처리방침" onClose={() => setOpen(null)}>
          <LegalBody items={PRIVACY} />
        </Modal>
      )}
    </>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} {SITE_NAME}</span>
      <LegalLinks />
      <span style={{ marginLeft: 'auto' }}>이 사이트는 관리자가 승인한 사람만 이용할 수 있습니다.</span>
    </footer>
  )
}

export function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleDateString('ko-KR', { year: '2-digit', month: 'short', day: 'numeric' })
}

// ===================== 분류(주제) + 드래그 이동 =====================
export const UNSORTED = '미분류'

// 정렬 기준 값. order 가 없으면 만든 시각을 씁니다.
export const orderOf = (it) => (typeof it.order === 'number' ? it.order : it.createdAt?.seconds || 0)

// 탭에 등록된 분류 순서대로 묶고, 등록되지 않은 분류 → 미분류 순으로 이어붙입니다.
export function groupByCategory(items, tab) {
  const map = new Map()
  for (const c of tab?.categories || []) map.set(c, [])
  for (const it of items) {
    const k = (it.category || '').trim() || UNSORTED
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(it)
  }
  if (!map.has(UNSORTED)) map.set(UNSORTED, [])
  const entries = [...map.entries()].map(([k, list]) => [k, [...list].sort((a, b) => orderOf(a) - orderOf(b))])
  const un = entries.find(([k]) => k === UNSORTED)
  return [...entries.filter(([k]) => k !== UNSORTED), un]
}

// 카드를 다른 카드 앞이나 분류의 맨 끝으로 옮깁니다. (옮기는 카드 하나만 저장됨)
export async function moveItem(item, targetCat, beforeItem, targetList) {
  const cat = targetCat === UNSORTED ? '' : targetCat
  let order
  if (!beforeItem) {
    const last = targetList[targetList.length - 1]
    order = last ? orderOf(last) + 1 : 1
  } else {
    const idx = targetList.findIndex((x) => x.id === beforeItem.id)
    const prev = targetList[idx - 1]
    order = prev ? (orderOf(prev) + orderOf(beforeItem)) / 2 : orderOf(beforeItem) - 1
  }
  await updateDoc(doc(db, 'items', item.id), { category: cat, order })
}

// 분류 순서 바꾸기: from 분류를 to 분류 앞으로 (to 가 미분류면 맨 뒤로)
async function reorderCategories(tab, from, to) {
  const cats = (tab.categories || []).filter((c) => c !== from)
  const idx = to === UNSORTED ? cats.length : cats.indexOf(to)
  cats.splice(idx < 0 ? cats.length : idx, 0, from)
  await updateDoc(doc(db, 'tabs', tab.id), { categories: cats })
}

// 드래그로 카드 위치 옮기기. cardProps 는 카드에, sectionProps 는 분류 묶음에, handleProps 는 분류 손잡이(⠿)에 펼쳐 넣습니다.
// 손잡이를 끌면 분류 전체(안의 카드 포함)가 다른 분류 앞으로 이동합니다.
export function useDragMove(items, profile, tab) {
  const [dragId, setDragId] = useState(null)
  const [dragCat, setDragCat] = useState(null) // 끌고 있는 분류 이름
  const [overId, setOverId] = useState(null) // 카드 id 또는 'cat:이름'
  const dragging = items.find((i) => i.id === dragId) || null
  const reset = () => {
    setDragId(null)
    setDragCat(null)
    setOverId(null)
  }

  const handleProps = (cat) => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation()
      setDragCat(cat)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', 'cat:' + cat)
    },
    onDragEnd: reset,
  })

  const cardProps = (it, cat, list) => ({
    draggable: canEdit(it, profile),
    onDragStart: (e) => {
      setDragId(it.id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', it.id)
    },
    onDragEnd: reset,
    onDragOver: (e) => {
      if (!dragging || dragging.id === it.id) return
      e.preventDefault()
      e.stopPropagation()
      if (overId !== it.id) setOverId(it.id)
    },
    onDrop: async (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!dragging || dragging.id === it.id) return
      await moveItem(dragging, cat, it, list.filter((x) => x.id !== dragging.id))
      reset()
    },
    'data-drag': `${dragId === it.id ? 'dragging' : ''} ${overId === it.id ? 'drop-before' : ''}`.trim(),
  })

  const sectionProps = (cat, list) => ({
    onDragOver: (e) => {
      if (!dragging && !dragCat) return
      if (dragCat && (dragCat === cat)) return
      e.preventDefault()
      if (overId !== 'cat:' + cat) setOverId('cat:' + cat)
    },
    onDrop: async (e) => {
      e.preventDefault()
      if (dragCat) {
        if (dragCat !== cat && tab) await reorderCategories(tab, dragCat, cat)
      } else if (dragging) {
        await moveItem(dragging, cat, null, list.filter((x) => x.id !== dragging.id))
      }
      reset()
    },
    'data-drop': overId === 'cat:' + cat ? (dragCat ? 'cat-target' : 'target') : '',
    'data-dragging-cat': dragCat === cat ? 'true' : undefined,
  })

  return { dragging, dragCat, cardProps, sectionProps, handleProps }
}

// 분류 추가·이름 바꾸기·삭제 (관리자). 탭 문서의 categories 배열에 저장됩니다.
// 사용: const cat = useCategoryTools(tab, isAdmin) → cat.button (제목 옆), cat.modal (맨 아래), cat.open(이름)
export function useCategoryTools(tab, isAdmin) {
  const [editing, setEditing] = useState(null) // null | '' (새로) | 기존 이름
  const [name, setName] = useState('')
  const cats = tab.categories || []

  const open = (c) => {
    setEditing(c)
    setName(c)
  }
  const itemsOf = (c) => getDocs(query(collection(db, 'items'), where('tabId', '==', tab.id), where('category', '==', c)))
  // 분류 이름 바꾸기 (소제목을 눌러 바로 고칠 때도 이 함수를 씁니다)
  const rename = async (oldName, newName) => {
    const n = newName.trim()
    if (!n || n === UNSORTED || n === oldName) return false
    if (cats.includes(n)) {
      alert('이미 있는 분류예요.')
      return false
    }
    const batch = writeBatch(db)
    batch.update(doc(db, 'tabs', tab.id), { categories: cats.map((c) => (c === oldName ? n : c)) })
    ;(await itemsOf(oldName)).forEach((d) => batch.update(d.ref, { category: n }))
    await batch.commit()
    return true
  }
  const save = async () => {
    const n = name.trim()
    if (!n || n === UNSORTED) return
    if (editing) {
      if (n !== editing && !(await rename(editing, n))) return
    } else {
      if (cats.includes(n)) return alert('이미 있는 분류예요.')
      await updateDoc(doc(db, 'tabs', tab.id), { categories: [...cats, n] })
    }
    setEditing(null)
  }
  const remove = async () => {
    if (!confirm(`'${editing}' 분류를 삭제할까요? 안에 있던 자료는 '미분류'로 옮겨져요.`)) return
    const batch = writeBatch(db)
    batch.update(doc(db, 'tabs', tab.id), { categories: cats.filter((c) => c !== editing) })
    ;(await itemsOf(editing)).forEach((d) => batch.update(d.ref, { category: '' }))
    await batch.commit()
    setEditing(null)
  }

  if (!isAdmin) return { button: null, modal: null, open: null, rename: null }

  const button = (
    <button className="btn secondary" onClick={() => open('')} data-tip="이 탭에 분류(주제) 칸 추가">
      ＋ 분류 추가
    </button>
  )
  const modal =
    editing === null ? null : (
      <Modal
        title={editing ? '분류 이름 바꾸기' : '분류 추가'}
        onClose={() => setEditing(null)}
        footer={
          <>
            {editing && (
              <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>
                삭제
              </button>
            )}
            <button className="btn ghost" onClick={() => setEditing(null)}>취소</button>
            <button className="btn" onClick={save} disabled={!name.trim()}>저장</button>
          </>
        }
      >
        <div className="field">
          <label>분류 이름</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 수업용, 개인용"
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <span className="hint">자료 카드를 끌어서 이 분류 안으로 옮길 수 있어요.</span>
        </div>
      </Modal>
    )
  return { button, modal, open, rename }
}

// 분류 소제목. 관리자는 글씨를 눌러 바로 이름을 고치고(Enter 저장, Esc 취소),
// 소제목 줄 아무 곳이나 끌어서 분류 전체를 옮기고, ✎ 로 삭제할 수 있어요.
export function CategoryHeading({ cat, onEdit, onRename, handleProps }) {
  const [val, setVal] = useState(null) // null = 보기 모드, 문자열 = 편집 중
  const editable = !!onRename && cat !== UNSORTED
  const commit = async () => {
    const v = val
    setVal(null)
    if (v != null && v.trim() && v.trim() !== cat) await onRename(cat, v)
  }
  const dragProps = editable && handleProps && val == null ? handleProps(cat) : {}
  return (
    <div className={`cat-h ${editable && val == null ? 'draggable' : ''}`} {...dragProps} title={editable && val == null ? '줄을 끌어서 분류 전체 옮기기' : undefined}>
      {editable && handleProps && <span className="cat-handle">⠿</span>}
      {val != null ? (
        <input
          className="input cat-h-input"
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setVal(null)
          }}
        />
      ) : (
        <span
          className={editable ? 'cat-h-name editable' : 'cat-h-name'}
          onClick={editable ? () => setVal(cat) : undefined}
          data-tip={editable ? '눌러서 이름 바꾸기' : undefined}
        >
          {cat}
        </span>
      )}
      {onEdit && cat !== UNSORTED && (
        <button className="btn ghost sm" onClick={() => onEdit(cat)} data-tip="분류 삭제·이름 바꾸기">
          ✎
        </button>
      )}
    </div>
  )
}

// 분류 선택 칸 (추가/수정 창에서 씀)
export function CategorySelect({ value, onChange, tab }) {
  const cats = tab?.categories || []
  return (
    <select className="select" value={cats.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{UNSORTED}</option>
      {cats.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )
}
