import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc } from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'
import { useAuth } from '../auth'
import {
  Modal, VisibilityBadge, VisibilitySelect, canEdit, fmtDate,
  groupByCategory, useDragMove, useCategoryTools, CategoryHeading, CategorySelect, UNSORTED,
} from './common'

// 파일 하나당 최대 크기(500MB). storage.rules 의 숫자와 같게 유지하세요.
export const MAX_FILE_MB = 500
// 하루에 올릴 수 있는 총 용량(GB). .env 의 VITE_DAILY_UPLOAD_GB 로 바꿀 수 있어요. (기본 5GB)
export const DAILY_UPLOAD_GB = Number(import.meta.env.VITE_DAILY_UPLOAD_GB) || 5
const GB = 1024 * 1024 * 1024

// 오늘 날짜 키 (예: 2026-09-17, 한국 시간 기준)
const todayKey = () => new Date().toLocaleDateString('sv-SE')
// 오늘 지금까지 올린 바이트 수 (stats/uploads_YYYY-MM-DD 문서)
async function usedToday() {
  const snap = await getDoc(doc(db, 'stats', `uploads_${todayKey()}`))
  return snap.exists() ? snap.data().bytes || 0 : 0
}
const addUsedToday = (bytes) =>
  setDoc(doc(db, 'stats', `uploads_${todayKey()}`), { bytes: increment(bytes), updatedAt: serverTimestamp() }, { merge: true })
const fmtGB = (b) => (b / GB).toFixed(2) + 'GB'

const ICONS = [
  [/^image\//, '🖼️'], [/^video\//, '🎬'], [/^audio\//, '🎵'], [/pdf/, '📕'],
  [/hwp|word|officedocument\.wordprocessing/, '📄'], [/sheet|excel|csv/, '📊'], [/presentation|powerpoint/, '📽️'],
  [/zip|rar|7z|compressed/, '🗜️'], [/text\//, '📃'],
]
const iconOf = (type = '', name = '') => {
  if (/\.hwpx?$/i.test(name)) return '📄'
  const hit = ICONS.find(([re]) => re.test(type))
  return hit ? hit[1] : '📎'
}
const fmtSize = (b = 0) =>
  b >= GB ? `${(b / GB).toFixed(2)}GB` : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`

// 어떤 파일이든 올려 두고 내려받는 탭
export function FilesTab({ tab, items }) {
  const { profile, isAdmin } = useAuth()
  const [adding, setAdding] = useState(false)
  const drag = useDragMove(items, profile, tab)
  const cat = useCategoryTools(tab, isAdmin)
  const groups = groupByCategory(items, tab).filter(([c, list]) => list.length || c !== UNSORTED || isAdmin)

  const remove = async (item) => {
    if (!confirm(`'${item.title}' 파일을 삭제할까요?`)) return
    await deleteDoc(doc(db, 'items', item.id))
    if (item.storagePath) deleteObject(ref(storage, item.storagePath)).catch(() => {})
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>{tab.name}</h1>
          <p>{tab.tip || `파일을 올려 두고 내려받아요. (파일 하나 ${MAX_FILE_MB}MB, 하루 총 ${DAILY_UPLOAD_GB}GB까지) 끌어서 순서나 분류를 바꿀 수 있어요.`}</p>
        </div>
        <div className="row">
          {cat.button}
          {isAdmin && (
            <button className="btn" onClick={() => setAdding(true)} data-tip="어떤 종류의 파일이든 올릴 수 있어요">
              ＋ 파일 올리기
            </button>
          )}
        </div>
      </div>

      {items.length === 0 && !(tab.categories || []).length ? (
        <div className="empty">아직 올라온 파일이 없어요.</div>
      ) : (
        groups.map(([c, list]) => (
          <section key={c} className="cat-section" data-cat={c} {...drag.sectionProps(c, list)}>
            <CategoryHeading cat={c} onEdit={cat.open} onRename={cat.rename} handleProps={isAdmin ? drag.handleProps : null} />
            <div className="list">
              {list.map((it) => (
                <div className="list-item" key={it.id} {...drag.cardProps(it, c, list)} data-tip={`분류: ${it.category || UNSORTED}`}>
                  <span style={{ fontSize: 22 }}>{iconOf(it.contentType, it.fileName)}</span>
                  <div className="grow">
                    <div className="name">{it.title}</div>
                    <div className="sub">
                      {it.fileName} · {fmtSize(it.size)} · {fmtDate(it.createdAt)}
                    </div>
                  </div>
                  <VisibilityBadge value={it.visibility} />
                  <a className="btn secondary sm" href={it.url} target="_blank" rel="noreferrer" download={it.fileName} data-tip="내려받기">
                    ⬇ 내려받기
                  </a>
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
      {adding && <FileUploader tab={tab} onClose={() => setAdding(false)} />}
    </>
  )
}

function FileUploader({ tab, onClose }) {
  const { profile } = useAuth()
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [visibility, setVisibility] = useState('approved')
  const [category, setCategory] = useState('')
  const [progress, setProgress] = useState(null) // null | 0~100
  const [err, setErr] = useState('')
  const [quota, setQuota] = useState(null) // 용량 초과 경고창 내용

  const onFile = (f) => {
    setFile(f)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  const save = async () => {
    setErr('')
    if (!file) return setErr('파일을 골라 주세요.')
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setErr(`파일 하나는 ${MAX_FILE_MB}MB 이하만 올릴 수 있어요.`)
    setProgress(0)
    try {
      // 1) 오늘 올린 총량 확인
      const used = await usedToday()
      const limit = DAILY_UPLOAD_GB * GB
      if (used + file.size > limit) {
        setProgress(null)
        return setQuota({
          title: '오늘 업로드할 수 있는 용량을 벗어났습니다',
          body: `오늘 가능한 용량 : ${fmtGB(Math.max(0, limit - used))}\n(하루 한도 ${DAILY_UPLOAD_GB}GB 중 ${fmtGB(used)} 사용 · 이 파일 ${fmtSize(file.size)})\n내일 다시 올리거나, 한도를 늘리려면 .env 의 VITE_DAILY_UPLOAD_GB 를 바꾸세요.`,
        })
      }
      const storagePath = `files/${profile.uid}/${Date.now()}_${file.name}`
      const task = uploadBytesResumable(ref(storage, storagePath), file, { contentType: file.type || 'application/octet-stream' })
      await new Promise((res, rej) =>
        task.on('state_changed', (s) => setProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)), rej, res),
      )
      const url = await getDownloadURL(task.snapshot.ref)
      await addDoc(collection(db, 'items'), {
        type: 'file',
        tabId: tab.id,
        title: title.trim() || file.name,
        fileName: file.name,
        size: file.size,
        contentType: file.type || '',
        url,
        storagePath,
        visibility,
        category,
        order: Date.now() / 1000,
        ownerUid: profile.uid,
        ownerName: profile.name || profile.email,
        createdAt: serverTimestamp(),
      })
      await addUsedToday(file.size).catch(() => {})
      onClose()
    } catch (e) {
      setProgress(null)
      // 2) Firebase 쪽 저장 공간·전송량 한도에 걸린 경우
      if (e?.code === 'storage/quota-exceeded') {
        return setQuota({
          title: 'Firebase 저장 공간 한도를 벗어났습니다',
          body: '무료 요금제는 총 5GB까지 저장할 수 있어요. 안 쓰는 파일을 지우거나, Firebase 콘솔에서 Blaze(종량제) 요금제로 올리면 계속 올릴 수 있어요.',
        })
      }
      if (e?.code === 'storage/retry-limit-exceeded') return setErr('네트워크가 끊겨 업로드를 마치지 못했어요. 다시 시도해 주세요.')
      setErr(e.message || '업로드에 실패했어요.')
    }
  }

  if (quota) {
    return (
      <Modal
        title={`⚠️ ${quota.title}`}
        onClose={() => setQuota(null)}
        footer={<button className="btn" onClick={() => setQuota(null)}>확인</button>}
      >
        <p style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>{quota.body}</p>
      </Modal>
    )
  }

  return (
    <Modal
      title="파일 올리기"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={save} disabled={progress !== null}>
            {progress === null ? '올리기' : `올리는 중… ${progress}%`}
          </button>
        </>
      }
    >
      <div className="field">
        <label>파일 (종류 제한 없음, 하나에 {MAX_FILE_MB}MB까지 · 하루 총 {DAILY_UPLOAD_GB}GB)</label>
        <input className="file-input" type="file" onChange={(e) => onFile(e.target.files?.[0] || null)} />
        {file && <span className="hint">{file.name} · {fmtSize(file.size)}</span>}
      </div>
      <div className="field">
        <label>표시 이름</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2학기 평가 계획" />
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
