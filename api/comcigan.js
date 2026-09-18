// Vercel 서버 함수: 컴시간알리미 학생용 웹 데이터(comci.net)를 가져와 JSON으로 돌려줍니다.
// 브라우저에서 직접 부르면 http/https 문제로 막히기 때문에 서버가 대신 가져옵니다.
//   GET /api/comcigan?school=학교이름&grade=2&cls=3   → 학급 시간표
//   GET /api/comcigan?school=학교이름&teacher=김선생   → 교사 시간표
//   GET /api/comcigan?school=학교이름                  → 학교·학년·반·교사 목록만
import Timetable from 'comcigan-parser'

const CACHE_MS = 30 * 60 * 1000 // 30분 동안은 같은 학교 데이터를 다시 받지 않음
const cache = new Map() // school → { at, data }

async function load(school) {
  const hit = cache.get(school)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const tt = new Timetable()
  await tt.init()
  const found = await tt.search(school)
  if (!found?.length) throw new Error(`컴시간에서 '${school}' 학교를 찾지 못했어요. 학교 이름을 확인해 주세요.`)
  const target = found.find((s) => s.name === school) || found[0]
  await tt.setSchool(target.code)
  const raw = await tt.getTimetable() // raw[학년][반] = [월, 화, 수, 목, 금] 각각 교시 배열
  let classTime = []
  try {
    classTime = await tt.getClassTime()
  } catch {}
  const data = { school: { name: target.name, code: target.code, region: target.region }, raw, classTime, fetchedAt: Date.now() }
  cache.set(school, data)
  return data
}

// 한 교시 항목을 통일된 모양으로
const norm = (p) => ({ subject: (p?.subject || '').trim(), teacher: (p?.teacher || '').trim() })

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800')
  const { school, grade, cls, teacher } = req.query || {}
  if (!school) return res.status(400).json({ error: 'school 값이 필요해요.' })
  try {
    const { school: info, raw, classTime } = await load(String(school))
    const grades = Object.keys(raw).map(Number).filter(Boolean).sort((a, b) => a - b)
    const classes = Object.fromEntries(grades.map((g) => [g, Object.keys(raw[g] || {}).map(Number).filter(Boolean).sort((a, b) => a - b)]))
    const teachers = new Set()
    for (const g of grades) for (const c of classes[g]) for (const day of raw[g][c] || []) for (const p of day || []) if (p?.teacher) teachers.add(p.teacher.trim())

    if (teacher) {
      // 교사 시간표: 모든 학급을 훑어 그 선생님 수업만 모읍니다
      const days = Array.from({ length: 5 }, () => [])
      for (const g of grades)
        for (const c of classes[g])
          (raw[g][c] || []).forEach((day, di) =>
            (day || []).forEach((p, pi) => {
              if ((p?.teacher || '').trim() === String(teacher).trim() && p?.subject) days[di][pi] = { ...norm(p), grade: g, cls: c }
            }),
          )
      return res.status(200).json({ school: info, classTime, teacher, days })
    }
    if (grade && cls) {
      const week = raw[Number(grade)]?.[Number(cls)]
      if (!week) return res.status(404).json({ error: `${grade}학년 ${cls}반 시간표가 없어요.`, grades, classes })
      const days = week.map((day) => (day || []).map(norm))
      return res.status(200).json({ school: info, classTime, grade: Number(grade), cls: Number(cls), days })
    }
    return res.status(200).json({ school: info, classTime, grades, classes, teachers: [...teachers].sort() })
  } catch (e) {
    return res.status(502).json({ error: e.message || '컴시간 데이터를 가져오지 못했어요.' })
  }
}
