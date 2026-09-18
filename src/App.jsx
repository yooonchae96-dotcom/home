import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, getDocs, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import { AuthProvider, useAuth } from './auth'
import { Sidebar } from './components/Sidebar'
import { LinksTab } from './components/LinksTab'
import { HtmlTab } from './components/HtmlTab'
import { FilesTab } from './components/FilesTab'
import { MemoTab } from './components/MemoTab'
import { AdminTab } from './components/AdminTab'
import { CalendarHome } from './components/CalendarHome'
import { LoginPage, PendingPage, LoadingPage } from './components/LoginPage'
import { Footer, canSee } from './components/common'

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

// 로그인 → 승인 → 홈페이지 순서로 문을 엽니다.
function Gate() {
  const { user, profile, isApproved, isAdmin } = useAuth()
  if (user === undefined) return <LoadingPage />
  if (!user) return <LoginPage />
  if (isAdmin || isApproved) return <Home />
  if (!profile) return <LoadingPage />
  return <PendingPage />
}

// 처음 한 번, 관리자가 들어왔는데 탭이 하나도 없으면 기본 탭 3개를 만들어 줍니다.
const DEFAULT_TABS = [
  { name: '링크 모음', type: 'links', icon: '🔗', tip: '자주 쓰는 사이트 모음', visibility: 'approved', order: 0 },
  { name: '파일 모음', type: 'files', icon: '📁', tip: '파일 올려 두고 내려받기', visibility: 'approved', order: 1 },
  { name: '웹앱', type: 'html', icon: '🧩', tip: 'HTML로 만든 앱 실행', visibility: 'approved', order: 2 },
  { name: '메모', type: 'memo', icon: '📝', tip: '메모 저장', visibility: 'approved', order: 3 },
]

function useTabs() {
  const { isAdmin } = useAuth()
  const [tabs, setTabs] = useState(null)
  useEffect(() => {
    const q = query(collection(db, 'tabs'), orderBy('order'))
    return onSnapshot(q, async (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setTabs(list)
      if (list.length === 0 && isAdmin) {
        const check = await getDocs(collection(db, 'tabs'))
        if (check.empty) {
          for (const t of DEFAULT_TABS) await addDoc(collection(db, 'tabs'), { ...t, createdAt: serverTimestamp() })
        }
      }
    })
  }, [isAdmin])
  return tabs
}

// 내가 볼 수 있는 자료만 실시간으로 받아옵니다. (보안 규칙과 같은 조건)
function useItems() {
  const { profile, isAdmin } = useAuth()
  const [shared, setShared] = useState([])
  const [mine, setMine] = useState([])

  useEffect(() => {
    if (!profile) return
    const col = collection(db, 'items')
    if (isAdmin) {
      return onSnapshot(query(col, orderBy('createdAt', 'desc')), (s) => {
        setShared(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        setMine([])
      })
    }
    const u1 = onSnapshot(
      query(col, where('visibility', 'in', ['approved', 'public']), orderBy('createdAt', 'desc')),
      (s) => setShared(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    )
    const u2 = onSnapshot(query(col, where('ownerUid', '==', profile.uid), orderBy('createdAt', 'desc')), (s) =>
      setMine(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    )
    return () => {
      u1()
      u2()
    }
  }, [profile?.uid, isAdmin])

  return useMemo(() => {
    const map = new Map()
    for (const it of [...shared, ...mine]) map.set(it.id, it)
    return [...map.values()]
      .filter((it) => canSee(it, profile))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
  }, [shared, mine, profile])
}

function Home() {
  const { profile } = useAuth()
  const allTabs = useTabs()
  const items = useItems()
  const [activeId, setActiveId] = useState('__home') // 첫 화면은 학사일정 달력
  const [focusCat, setFocusCat] = useState(null) // 사이드바 안내 창에서 누른 분류

  // 탭이 바뀌고 화면이 그려진 뒤, 고른 분류 칸을 세로 가운데로 스크롤
  useEffect(() => {
    if (!focusCat) return
    const t = setTimeout(() => {
      const el = document.querySelector(`.cat-section[data-cat="${CSS.escape(focusCat)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('flash')
        setTimeout(() => el.classList.remove('flash'), 1200)
      }
      setFocusCat(null)
    }, 80)
    return () => clearTimeout(t)
  }, [focusCat, activeId])

  const goto = (tabId, cat) => {
    setActiveId(tabId)
    setFocusCat(cat)
  }

  const tabs = useMemo(() => (allTabs || []).filter((t) => canSee({ ...t, ownerUid: '' }, profile)), [allTabs, profile])


  if (!allTabs) return <LoadingPage />

  const tab = tabs.find((t) => t.id === activeId)
  const tabItems = tab ? items.filter((it) => it.tabId === tab.id) : []

  let body = null
  if (activeId === '__home') body = <CalendarHome />
  else if (activeId === '__admin') body = <AdminTab />
  else if (!tab) body = <div className="empty">왼쪽에서 탭을 골라 주세요. (관리자는 '탭 추가'로 만들 수 있어요)</div>
  else if (tab.type === 'links') body = <LinksTab tab={tab} items={tabItems} />
  else if (tab.type === 'files') body = <FilesTab tab={tab} items={tabItems} />
  else if (tab.type === 'html') body = <HtmlTab tab={tab} items={tabItems} />
  else if (tab.type === 'memo') body = <MemoTab tab={tab} items={tabItems} />

  return (
    <div className="layout">
      <Sidebar tabs={tabs} items={items} activeId={activeId} onSelect={setActiveId} onGoto={goto} />
      <div className="main">
        <div className={`content ${activeId === '__home' ? 'wide' : ''}`}>{body}</div>
        <Footer />
      </div>
    </div>
  )
}
