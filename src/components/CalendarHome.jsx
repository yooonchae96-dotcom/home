import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../auth'
import { Modal } from './common'

// ===================== 나이스(NEIS) 오픈 API =====================
// 설정은 Firestore settings/neis 문서에 저장되고, 없으면 .env 값을 씁니다.
const ENV_DEFAULT = {
  key: import.meta.env.VITE_NEIS_KEY || '',
  atpt: import.meta.env.VITE_NEIS_ATPT || '', // 시도교육청코드 (예: B10 서울)
  schul: import.meta.env.VITE_NEIS_SCHUL || '', // 행정표준코드 (학교 코드)
  schoolName: import.meta.env.VITE_SCHOOL_NAME || '',
  schoolType: 'mis', // els(초) / mis(중) / his(고)
}
const SCHOOL_TYPES = { els: '초등학교', mis: '중학교', his: '고등학교' }

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const parseYmd = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)))
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const isReady = (cfg) => !!(cfg?.key && cfg?.atpt && cfg?.schul)

// 공통 호출: 서비스 이름과 추가 파라미터를 받아 row 배열을 돌려줍니다. (데이터 없음 = 빈 배열)
async function neis(cfg, service, params) {
  const q = new URLSearchParams({ KEY: cfg.key, Type: 'json', pIndex: '1', pSize: '500', ATPT_OFCDC_SC_CODE: cfg.atpt, SD_SCHUL_CODE: cfg.schul, ...params })
  const res = await fetch(`https://open.neis.go.kr/hub/${service}?${q}`)
  if (!res.ok) throw new Error(`나이스 서버 응답 오류 (${res.status})`)
  const json = await res.json()
  if (json.RESULT) {
    if (json.RESULT.CODE === 'INFO-200') return [] // 해당 기간 데이터 없음 (정상)
    throw new Error(`${json.RESULT.MESSAGE} (${json.RESULT.CODE})`)
  }
  return json[service]?.[1]?.row || []
}

// 한 달치 학사일정 → { 'YYYYMMDD': [{name, kind, memo, grades}] }
async function fetchSchedule(cfg, year, month) {
  const rows = await neis(cfg, 'SchoolSchedule', {
    AA_FROM_YMD: `${year}${pad(month)}01`,
    AA_TO_YMD: `${year}${pad(month)}${new Date(year, month, 0).getDate()}`,
  })
  const byDay = {}
  for (const r of rows) {
    const name = (r.EVENT_NM || '').trim()
    if (!name) continue
    const grades = ['ONE', 'TW', 'THREE', 'FR', 'FIV', 'SIX'].map((g, i) => (r[`${g}_GRADE_EVENT_YN`] === 'Y' ? i + 1 : null)).filter(Boolean)
    const list = (byDay[r.AA_YMD] ||= [])
    const same = list.find((e) => e.name === name)
    if (same) same.grades = [...new Set([...same.grades, ...grades])]
    else list.push({ name, kind: r.SBTR_DD_SC_NM || '', memo: r.EVENT_CNTNT || '', grades })
  }
  return byDay
}

// 하루 급식 → [{meal:'중식', dishes:[...], cal}]
async function fetchMeal(cfg, dayKey) {
  const rows = await neis(cfg, 'mealServiceDietInfo', { MLSV_YMD: dayKey })
  return rows.map((r) => ({
    meal: r.MMEAL_SC_NM,
    cal: r.CAL_INFO,
    dishes: (r.DDISH_NM || '')
      .split(/<br\s*\/?>/i)
      .map((s) => s.replace(/\s*\([\d.\s]*\)\s*$/, '').trim()) // 알레르기 번호 제거
      .filter(Boolean),
  }))
}

// 한 주 시간표 → { 'YYYYMMDD': { 교시: 과목 } }
async function fetchTimetable(cfg, fromKey, toKey, grade, cls) {
  const service = `${cfg.schoolType || 'mis'}Timetable`
  const rows = await neis(cfg, service, { TI_FROM_YMD: fromKey, TI_TO_YMD: toKey, GRADE: String(grade), CLASS_NM: String(cls) })
  const byDay = {}
  for (const r of rows) (byDay[r.ALL_TI_YMD] ||= {})[Number(r.PERIO)] = (r.ITRT_CNTNT || '').trim()
  return byDay
}

// 컴시간알리미 (Vercel 서버 함수 /api/comcigan 경유). 실패하면 null → 나이스로 대체
async function comci(params) {
  const q = new URLSearchParams(params)
  const res = await fetch(`/api/comcigan?${q}`, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('서버 함수가 없어요 (로컬 실행 중이거나 Vercel 배포 전)')
  }
  if (!res.ok) throw new Error(json.error || `오류 ${res.status}`)
  return json
}
const isSameWeek = (a, b) => {
  const mon = (d) => {
    const m = new Date(d)
    m.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return ymd(m)
  }
  return mon(a) === mon(b)
}

// 교시 시간 (현재 교시 표시용). 학교 시정에 맞게 고쳐 쓰세요.
const PERIOD_TIMES = { 1: ['09:00', '09:45'], 2: ['09:55', '10:40'], 3: ['10:50', '11:35'], 4: ['11:45', '12:30'], 5: ['13:20', '14:05'], 6: ['14:15', '15:00'], 7: ['15:10', '15:55'] }
function currentPeriod(now = new Date()) {
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  for (const [p, [a, b]] of Object.entries(PERIOD_TIMES)) if (t >= a && t <= b) return Number(p)
  return null
}

// ===================== 첫 화면 =====================
export function CalendarHome() {
  const { isAdmin, profile } = useAuth()
  const [cfg, setCfg] = useState(null)
  const [editing, setEditing] = useState(false)
  const [myEvents, setMyEvents] = useState([]) // 내가 직접 넣은 일정 (Firestore events)
  const [evEditing, setEvEditing] = useState(null) // null | 'new' | 일정 객체
  const today = new Date()
  const [cur, setCur] = useState({ y: today.getFullYear(), m: today.getMonth() + 1 })
  const [selected, setSelected] = useState(ymd(today)) // 누른 날짜 (급식·시간표 기준)
  const [cache, setCache] = useState({})
  const [status, setStatus] = useState('')

  useEffect(() => {
    return onSnapshot(
      doc(db, 'settings', 'neis'),
      (snap) => setCfg(snap.exists() ? { ...ENV_DEFAULT, ...snap.data() } : ENV_DEFAULT),
      () => setCfg(ENV_DEFAULT),
    )
  }, [])

  // 직접 넣은 일정: 삭제하기 전까지 DB(events 컬렉션)에 계속 남아 있어요
  useEffect(() => {
    return onSnapshot(collection(db, 'events'), (snap) => setMyEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])
  const removeEvent = async (ev) => {
    if (!confirm(`'${ev.title}' 일정을 삭제할까요?`)) return
    await deleteDoc(doc(db, 'events', ev.id))
  }

  const key = `${cur.y}-${cur.m}`
  useEffect(() => {
    if (!cfg) return
    if (!isReady(cfg)) return setStatus('나이스 API 설정이 아직 없어요. 오른쪽 위 "API 변경"에서 인증키·교육청코드·학교코드를 넣어 주세요.')
    if (cache[key]) return setStatus('')
    let alive = true
    setStatus('학사일정을 불러오는 중…')
    fetchSchedule(cfg, cur.y, cur.m)
      .then((data) => alive && (setCache((c) => ({ ...c, [key]: data })), setStatus('')))
      .catch((e) => alive && setStatus(`학사일정을 불러오지 못했어요: ${e.message}`))
    return () => (alive = false)
  }, [cfg, key]) // eslint-disable-line

  // 나이스 일정 + 직접 넣은 일정을 날짜별로 합칩니다
  const events = useMemo(() => {
    const merged = {}
    for (const [k, list] of Object.entries(cache[key] || {})) merged[k] = list.map((e) => ({ ...e, source: 'neis' }))
    for (const ev of myEvents) {
      const from = ev.start || ev.date
      const to = ev.end || from
      if (!from) continue
      for (let d = parseYmd(from); ymd(d) <= to; d.setDate(d.getDate() + 1)) {
        const k = ymd(d)
        ;(merged[k] ||= []).push({ name: ev.title, kind: ev.kind || '', memo: ev.memo || '', grades: [], source: 'mine', raw: ev })
      }
    }
    return merged
  }, [cache, key, myEvents])
  const cells = useMemo(() => {
    const first = new Date(cur.y, cur.m - 1, 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [cur])

  const move = (n) => {
    const d = new Date(cur.y, cur.m - 1 + n, 1)
    setCur({ y: d.getFullYear(), m: d.getMonth() + 1 })
  }
  const goToday = () => {
    setCur({ y: today.getFullYear(), m: today.getMonth() + 1 })
    setSelected(ymd(today))
  }
  const todayKey = ymd(today)
  const selDate = parseYmd(selected)

  return (
    <div className="home-grid">
      {/* 왼쪽: 큰 달력 */}
      <div className="cal">
        <div className="cal-head">
          <div className="cal-title">
            <h1>{cur.y}년 {cur.m}월</h1>
            <p>{cfg?.schoolName ? `${cfg.schoolName} 학사일정` : '학사일정 (나이스)'} · 날짜를 누르면 오른쪽에 그날 급식과 시간표가 보여요. 날짜 칸의 + 로 내 일정을 넣어요</p>
          </div>
          <div className="row">
            <button className="btn secondary sm" onClick={() => move(-1)} data-tip="지난달">‹</button>
            <button className="btn secondary sm" onClick={goToday}>오늘</button>
            <button className="btn secondary sm" onClick={() => move(1)} data-tip="다음달">›</button>
            {isAdmin && (
              <button className="btn ghost sm" onClick={() => setEditing(true)} data-tip="나이스 API 인증키·학교코드 바꾸기">⚙ API 변경</button>
            )}
          </div>
        </div>
        {status && <div className={`cal-status ${/불러오지|설정이 아직/.test(status) ? 'warn' : ''}`}>{status}</div>}
        <div className="cal-grid">
          {WEEK.map((w, i) => (
            <div key={w} className={`cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>{w}</div>
          ))}
          {cells.map((d) => {
            const k = ymd(d)
            const inMonth = d.getMonth() + 1 === cur.m
            const list = events[k] || []
            const off = list.some((e) => /휴업|방학|공휴|재량/.test(e.kind + e.name))
            const dow = d.getDay()
            return (
              <div
                key={k}
                className={`cal-cell ${inMonth ? '' : 'dim'} ${k === todayKey ? 'today' : ''} ${dow === 0 || off ? 'sun' : dow === 6 ? 'sat' : ''} ${selected === k ? 'sel' : ''}`}
                onClick={() => {
                  setSelected(k)
                  if (!inMonth) setCur({ y: d.getFullYear(), m: d.getMonth() + 1 })
                }}
              >
                <div className="cal-day">
                  {d.getDate()}
                  <button
                    className="cal-add"
                    title="이 날에 내 일정 추가"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      setSelected(k)
                      if (!inMonth) setCur({ y: d.getFullYear(), m: d.getMonth() + 1 })
                      setEvEditing('new')
                    }}
                  >
                    +
                  </button>
                </div>
                <div className="cal-events">
                  {list.slice(0, 3).map((e, i) => (
                    <div
                      key={i}
                      className={`cal-ev ${off && e.source !== 'mine' ? 'off' : ''} ${e.source === 'mine' ? 'mine' : ''}`}
                      title={e.memo || e.name}
                      onClick={(ev) => {
                        if (e.source !== 'mine') return
                        ev.stopPropagation()
                        setSelected(k)
                        setEvEditing(e.raw)
                      }}
                    >
                      {e.name}
                      {e.grades.length > 0 && e.grades.length < 3 && <span className="cal-grade">{e.grades.join(',')}학년</span>}
                    </div>
                  ))}
                  {list.length > 3 && <div className="cal-more">+{list.length - 3}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 오른쪽: 위 급식, 아래 시간표 */}
      <div className="home-side">
        <MealCard cfg={cfg} dayKey={selected} date={selDate} events={events[selected] || []} onEdit={setEvEditing} onRemove={removeEvent} profile={profile} isAdmin={isAdmin} />
        <TimetableCard cfg={cfg} date={selDate} />
      </div>

      {editing && <NeisSettings cfg={cfg} onClose={() => setEditing(false)} onSaved={() => setCache({})} />}
      {evEditing && <EventEditor ev={evEditing === 'new' ? null : evEditing} dayKey={selected} onClose={() => setEvEditing(null)} onRemove={removeEvent} />}
    </div>
  )
}

// ---------- 내 일정 추가·수정 창 ----------
function EventEditor({ ev, dayKey, onClose, onRemove }) {
  const { profile } = useAuth()
  const toInput = (k) => (k ? `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}` : '')
  const fromInput = (v) => v.replaceAll('-', '')
  const [title, setTitle] = useState(ev?.title || '')
  const [start, setStart] = useState(toInput(ev?.start || ev?.date || dayKey))
  const [end, setEnd] = useState(toInput(ev?.end || ev?.start || ev?.date || dayKey))
  const [memo, setMemo] = useState(ev?.memo || '')
  const [kind, setKind] = useState(ev?.kind || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setErr('')
    if (!title.trim()) return setErr('일정 이름을 넣어 주세요.')
    if (!start) return setErr('날짜를 골라 주세요.')
    const s = fromInput(start)
    const e = end ? fromInput(end) : s
    if (e < s) return setErr('끝나는 날짜가 시작 날짜보다 빠를 수 없어요.')
    setSaving(true)
    try {
      const data = { title: title.trim(), start: s, end: e, memo: memo.trim(), kind, updatedAt: serverTimestamp() }
      if (ev) await updateDoc(doc(db, 'events', ev.id), data)
      else await addDoc(collection(db, 'events'), { ...data, ownerUid: profile.uid, ownerName: profile.name || profile.email, createdAt: serverTimestamp() })
      onClose()
    } catch (e2) {
      setErr(e2.message || '저장에 실패했어요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={ev ? '내 일정 수정' : '내 일정 추가'}
      onClose={onClose}
      footer={
        <>
          {ev && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => onRemove(ev).then(onClose)}>삭제</button>
          )}
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </>
      }
    >
      <div className="field">
        <label>일정 이름</label>
        <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2학년 수행평가" onKeyDown={(e) => e.key === 'Enter' && save()} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>시작</label>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>끝 (하루면 비워 두기)</label>
          <input className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>종류</label>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">일반</option>
          <option value="휴업일">휴업일·쉬는 날 (빨간색)</option>
        </select>
      </div>
      <div className="field">
        <label>메모 (선택)</label>
        <textarea className="textarea" style={{ minHeight: 70 }} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="장소, 준비물 등" />
      </div>
      <span className="hint">저장하면 삭제할 때까지 DB에 남아 있고, 승인된 사람 모두에게 보여요.</span>
      {err && <p className="error">{err}</p>}
    </Modal>
  )
}

// ---------- 급식표 (오른쪽 위) ----------
function MealCard({ cfg, dayKey, date, events, onEdit, onRemove, profile, isAdmin }) {
  const [data, setData] = useState({}) // dayKey → meals
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!isReady(cfg)) return
    if (data[dayKey]) return setMsg('')
    let alive = true
    setMsg('불러오는 중…')
    fetchMeal(cfg, dayKey)
      .then((m) => alive && (setData((d) => ({ ...d, [dayKey]: m })), setMsg('')))
      .catch((e) => alive && setMsg(`급식을 불러오지 못했어요: ${e.message}`))
    return () => (alive = false)
  }, [cfg, dayKey]) // eslint-disable-line
  const meals = data[dayKey] || []
  return (
    <div className="card side-card">
      <div className="side-head">
        <h3>🍚 급식표</h3>
        <span className="hint">{date.getMonth() + 1}월 {date.getDate()}일 ({WEEK[date.getDay()]})</span>
      </div>
      {msg && <div className="hint">{msg}</div>}
      {!msg && meals.length === 0 && <div className="hint">이 날은 급식 정보가 없어요.</div>}
      {meals.map((m) => (
        <div key={m.meal} className="meal">
          <div className="meal-name">{m.meal} {m.cal && <span className="hint">{m.cal}</span>}</div>
          <ul className="meal-list">
            {m.dishes.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ))}
      {events.length > 0 && (
        <div className="side-events">
          {events.map((e, i) => {
            const mine = e.source === 'mine'
            const canDo = mine && (isAdmin || e.raw?.ownerUid === profile?.uid)
            return (
              <div key={i} className={`cal-ev ${/휴업|방학|공휴|재량/.test(e.kind + e.name) ? 'off' : ''} ${mine ? 'mine' : ''} side-ev`} title={e.memo || ''}>
                <span className="grow">
                  {e.name}
                  {e.grades.length > 0 && e.grades.length < 3 && <span className="cal-grade">{e.grades.join(',')}학년</span>}
                  {mine && e.memo && <div className="hint" style={{ whiteSpace: 'normal' }}>{e.memo}</div>}
                </span>
                {canDo && (
                  <>
                    <button className="btn ghost sm" onClick={() => onEdit(e.raw)} data-tip="수정">✎</button>
                    <button className="btn ghost sm" onClick={() => onRemove(e.raw)} data-tip="삭제">🗑</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------- 시간표 (오른쪽 아래): 학년·반·과목 선택 ----------
function TimetableCard({ cfg, date }) {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('tt-pick') || '{}')
    } catch {
      return {}
    }
  })()
  const [grade, setGrade] = useState(saved.grade || 1)
  const [cls, setCls] = useState(saved.cls || 1)
  const [subject, setSubject] = useState('') // '' = 전체
  const [data, setData] = useState({}) // weekKey → byDay
  const [msg, setMsg] = useState('')
  // 컴시간: 학교 정보(학년·반·교사 목록)와 시간표. 실패하면 나이스로 대체
  const [meta, setMeta] = useState(undefined) // undefined=확인 중, null=사용 불가, {…}=사용 가능
  const [mode, setMode] = useState(saved.mode || 'class') // class | teacher
  const [teacher, setTeacher] = useState(saved.teacher || '')
  const [cc, setCc] = useState({}) // 컴시간 시간표 캐시
  const comciSchool = cfg?.comciSchool || cfg?.schoolName || ''

  // 그 주 월~금
  const mon = new Date(date)
  mon.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
  const weekKey = `${ymd(days[0])}-${grade}-${cls}`

  useEffect(() => {
    try {
      localStorage.setItem('tt-pick', JSON.stringify({ grade, cls, mode, teacher }))
    } catch {}
  }, [grade, cls, mode, teacher])

  // 컴시간 사용 가능한지 확인 (학교 목록·교사 목록)
  useEffect(() => {
    if (!comciSchool) return setMeta(null)
    let alive = true
    comci({ school: comciSchool })
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setMeta(null))
    return () => (alive = false)
  }, [comciSchool])

  const thisWeek = isSameWeek(date, new Date())
  const useComci = !!meta && thisWeek
  const ccKey = mode === 'teacher' ? `t:${teacher}` : `c:${grade}-${cls}`

  // 컴시간 시간표 가져오기 (이번 주만 제공)
  useEffect(() => {
    if (!useComci || cc[ccKey]) return
    if (mode === 'teacher' && !teacher) return
    let alive = true
    setMsg('컴시간에서 불러오는 중…')
    comci(mode === 'teacher' ? { school: comciSchool, teacher } : { school: comciSchool, grade, cls })
      .then((r) => alive && (setCc((c) => ({ ...c, [ccKey]: r })), setMsg('')))
      .catch((e) => alive && setMsg(`컴시간에서 불러오지 못했어요: ${e.message}`))
    return () => (alive = false)
  }, [useComci, ccKey, mode, teacher, grade, cls, comciSchool]) // eslint-disable-line

  useEffect(() => {
    if (useComci || meta === undefined) return // 컴시간을 쓰거나 아직 확인 중이면 나이스는 부르지 않음
    if (!isReady(cfg)) return
    if (data[weekKey]) return setMsg('')
    let alive = true
    setMsg('나이스에서 불러오는 중…')
    fetchTimetable(cfg, ymd(days[0]), ymd(days[4]), grade, cls)
      .then((t) => alive && (setData((d) => ({ ...d, [weekKey]: t })), setMsg('')))
      .catch((e) => alive && setMsg(`시간표를 불러오지 못했어요: ${e.message}`))
    return () => (alive = false)
  }, [cfg, weekKey, useComci, meta]) // eslint-disable-line

  // 두 출처를 같은 모양( week[날짜][교시] = {subject, teacher, grade, cls} )으로 맞춥니다
  let week = {}
  if (useComci && cc[ccKey]) {
    cc[ccKey].days.forEach((day, di) => {
      const k = ymd(days[di])
      week[k] = {}
      ;(day || []).forEach((p, pi) => {
        if (p?.subject) week[k][pi + 1] = p
      })
    })
  } else {
    for (const [k, d] of Object.entries(data[weekKey] || {})) week[k] = Object.fromEntries(Object.entries(d).map(([p, v]) => [p, { subject: v }]))
  }
  const periods = Math.max(0, ...Object.values(week).flatMap((d) => Object.keys(d).map(Number)))
  const subjects = [...new Set(Object.values(week).flatMap((d) => Object.values(d).map((p) => p.subject)))].filter(Boolean).sort()
  const todayKey = ymd(new Date())
  const nowP = currentPeriod()
  const selKey = ymd(date)
  const gradeList = meta?.grades?.length ? meta.grades : [1, 2, 3]
  const classList = meta?.classes?.[grade]?.length ? meta.classes[grade] : Array.from({ length: 15 }, (_, i) => i + 1)

  return (
    <div className="card side-card">
      <div className="side-head">
        <h3>🕘 시간표</h3>
        <span className="hint">
          {days[0].getMonth() + 1}/{days[0].getDate()} ~ {days[4].getMonth() + 1}/{days[4].getDate()} · {useComci ? '컴시간' : '나이스'}
        </span>
      </div>
      {meta && (
        <div className="row tt-mode">
          <button className={`btn sm ${mode === 'class' ? '' : 'ghost'}`} onClick={() => setMode('class')}>학급별</button>
          <button className={`btn sm ${mode === 'teacher' ? '' : 'ghost'}`} onClick={() => setMode('teacher')} disabled={!thisWeek}>
            선생님별
          </button>
          {!thisWeek && <span className="hint">다른 주는 나이스 시간표로 보여요</span>}
        </div>
      )}
      <div className="row tt-pick">
        {useComci && mode === 'teacher' ? (
          <select className="select" value={teacher} onChange={(e) => setTeacher(e.target.value)} data-tip="선생님">
            <option value="">선생님 선택</option>
            {(meta.teachers || []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        ) : (
          <>
            <select className="select" value={grade} onChange={(e) => setGrade(Number(e.target.value))} data-tip="학년">
              {gradeList.map((g) => (
                <option key={g} value={g}>{g}학년</option>
              ))}
            </select>
            <select className="select" value={cls} onChange={(e) => setCls(Number(e.target.value))} data-tip="반">
              {classList.map((c) => (
                <option key={c} value={c}>{c}반</option>
              ))}
            </select>
          </>
        )}
        <select className="select" value={subject} onChange={(e) => setSubject(e.target.value)} data-tip="과목만 골라 보기">
          <option value="">모든 과목</option>
          {subjects.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {msg && <div className="hint">{msg}</div>}
      {!msg && periods === 0 && <div className="hint">{useComci && mode === 'teacher' && !teacher ? '선생님을 골라 주세요.' : '이 주는 시간표 정보가 없어요.'}</div>}
      {periods > 0 && (
        <div className="tt-wrap">
          <table className="tt">
            <thead>
              <tr>
                <th></th>
                {days.map((d) => (
                  <th key={ymd(d)} className={`${ymd(d) === selKey ? 'sel' : ''} ${ymd(d) === todayKey ? 'today' : ''}`}>
                    {WEEK[d.getDay()]}<br /><span className="hint">{d.getDate()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: periods }, (_, i) => i + 1).map((p) => (
                <tr key={p} className={nowP === p && selKey === todayKey ? 'now' : ''}>
                  <th>{p}</th>
                  {days.map((d) => {
                    const cell = week[ymd(d)]?.[p]
                    const v = cell?.subject || ''
                    const hit = subject && v === subject
                    const dimmed = subject && v && !hit
                    const sub = useComci && mode === 'teacher' && cell ? `${cell.grade}-${cell.cls}` : useComci && cell?.teacher ? cell.teacher : ''
                    return (
                      <td key={ymd(d)} className={`${ymd(d) === selKey ? 'sel' : ''} ${hit ? 'hit' : ''} ${dimmed ? 'dim' : ''}`} title={sub ? `${v} · ${sub}` : v}>
                        {v}
                        {sub && <div className="tt-sub">{sub}</div>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nowP && selKey === todayKey && periods > 0 && <div className="hint" style={{ marginTop: 6 }}>지금은 {nowP}교시예요. (교시 시간은 CalendarHome.jsx 의 PERIOD_TIMES 에서 조정)</div>}
    </div>
  )
}

// ---------- 나이스 API 설정 창 (관리자) ----------
function NeisSettings({ cfg, onClose, onSaved }) {
  const [form, setForm] = useState({
    key: cfg?.key || '', atpt: cfg?.atpt || '', schul: cfg?.schul || '', schoolName: cfg?.schoolName || '', schoolType: cfg?.schoolType || 'mis',
    comciSchool: cfg?.comciSchool || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value.trim() }))

  const save = async () => {
    setErr('')
    if (!form.key || !form.atpt || !form.schul) return setErr('인증키, 시도교육청코드, 행정표준코드는 꼭 넣어 주세요.')
    setSaving(true)
    try {
      const now = new Date()
      await fetchSchedule(form, now.getFullYear(), now.getMonth() + 1) // 저장 전 확인
      await setDoc(doc(db, 'settings', 'neis'), { ...form, updatedAt: serverTimestamp() }, { merge: true })
      onSaved()
      onClose()
    } catch (e) {
      setErr(`확인 실패: ${e.message}. 값을 다시 확인해 주세요.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="나이스 학사일정·급식·시간표 API 설정"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? '확인 중…' : '저장'}</button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        나이스 교육정보 개방포털(open.neis.go.kr)에서 발급받은 인증키와 학교 코드를 넣어요. 학교가 바뀌면 여기서 코드만 바꾸면 됩니다.
      </p>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>학교 이름 (달력 제목에 표시, 선택)</label>
          <input className="input" value={form.schoolName} onChange={set('schoolName')} placeholder="예: ○○중학교" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>학교급</label>
          <select className="select" value={form.schoolType} onChange={set('schoolType')}>
            {Object.entries(SCHOOL_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>나이스 API 인증키 (KEY)</label>
        <input className="input" value={form.key} onChange={set('key')} placeholder="32자리 영문·숫자" />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>시도교육청코드</label>
          <input className="input" value={form.atpt} onChange={set('atpt')} placeholder="예: B10" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>행정표준코드 (학교)</label>
          <input className="input" value={form.schul} onChange={set('schul')} placeholder="예: 7051209" />
        </div>
      </div>
      <span className="hint">학교 코드는 open.neis.go.kr → 학교기본정보에서 학교 이름으로 검색하면 나와요.</span>
      <div className="field" style={{ marginTop: 14 }}>
        <label>컴시간알리미 학교 검색어 (선택)</label>
        <input className="input" value={form.comciSchool} onChange={set('comciSchool')} placeholder="비우면 위의 학교 이름으로 찾아요" />
        <span className="hint">
          시간표는 컴시간 학생용 웹(comci.net) 자료를 먼저 쓰고, 안 되면 나이스 시간표를 써요. 컴시간 검색에서 학교가 안 나오면 '태랑중'처럼 짧게 적어 보세요.
          (Vercel에 배포했을 때만 동작하고, 내 컴퓨터에서 실행 중일 때는 자동으로 나이스를 씁니다)
        </span>
      </div>
      {err && <p className="error">{err}</p>}
    </Modal>
  )
}
