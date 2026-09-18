import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, googleProvider, isAdminEmail } from './firebase'

const AuthCtx = createContext(null)

// users/{uid} 문서를 만들거나(처음 로그인) 갱신합니다. 관리자는 자동 승인.
async function ensureUserDoc(u, extra = {}) {
  const admin = isAdminEmail(u.email)
  const ref = doc(db, 'users', u.uid)
  const snap = await getDoc(ref)
  const base = {
    email: u.email,
    name: u.displayName || '',
    photo: u.photoURL || '',
    lastLogin: serverTimestamp(),
    ...extra,
  }
  if (!snap.exists()) {
    await setDoc(ref, { ...base, role: admin ? 'admin' : 'member', status: admin ? 'approved' : 'pending' })
  } else if (admin && snap.data().status !== 'approved') {
    await setDoc(ref, { ...base, role: 'admin', status: 'approved' }, { merge: true })
  } else {
    await setDoc(ref, base, { merge: true })
  }
}

// 로그인 상태 + users/{uid} 문서(승인 여부, 관리자 여부)를 앱 전체에 공급합니다.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = 아직 확인 중
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u) await ensureUserDoc(u).catch(console.error)
      setUser(u)
      if (!u) setProfile(null)
    })
  }, [])

  useEffect(() => {
    if (!user) return
    const ref = doc(db, 'users', user.uid)
    return onSnapshot(ref, (snap) => {
      const data = snap.data() || {}
      setProfile({
        uid: user.uid,
        email: user.email,
        name: user.displayName,
        photo: user.photoURL,
        role: data.role || 'member',
        status: data.status || 'pending',
        agreedTerms: !!data.agreedTerms,
      })
    })
  }, [user])

  // 로그인 화면에서 약관에 동의한 뒤에만 호출되므로, 동의 기록도 함께 남깁니다.
  const login = async () => {
    const cred = await signInWithPopup(auth, googleProvider)
    await ensureUserDoc(cred.user, { agreedTerms: true, agreedAt: serverTimestamp() })
  }
  const logout = () => signOut(auth)

  const value = {
    user,
    profile,
    isAdmin: profile?.role === 'admin',
    isApproved: profile?.status === 'approved',
    login,
    logout,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
