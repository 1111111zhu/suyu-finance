// Shared by collection, assessment and the page. Dates are application dates,
// never policy validity, publication dates or a public-comment period.
export const cleanPolicyText = (value = "") => String(value).normalize("NFKC").replaceAll("⻅", "见").replace(/\s+/g, "");

export function deadlineInstant(date, time = "") {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date || "")) return null;
  const calendar = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(+calendar) || calendar.toISOString().slice(0, 10) !== date) return null;
  const value = new Date(`${date}T${time === "24:00" ? "24:00:00" : time ? `${time}:00` : "23:59:59"}+08:00`);
  return Number.isNaN(+value) ? null : value;
}

export function extractApplicationTiming(policy, now = new Date()) {
  const text = cleanPolicyText(policy.applicationContent || policy.content || policy.summary || "");
  const year = String(policy.publishDate || "").match(/^20\d{2}/)?.[0]
    || cleanPolicyText(policy.title).match(/(20\d{2})年/)?.[1];
  const windows = [];
  const ignoredDates = [];
  const openings = [];
  for (const sentence of text.split(/[。；;\n，,]/)) {
    if (!/(申报|申请|受理|提交|报送|填报|系统|截止|推荐)/.test(sentence)) continue;
    const actionTime = /(?:申报|申请|申领|领用|受理|提交|报送|填报|推荐).{0,8}(?:时间|窗口|截止|截至)/.test(sentence);
    if (/(公示期|有效期|实施期|建设周期|购置|发生|发放|支出|统计期|成立|注册|项目开始时间|项目结束时间)/.test(sentence) && !actionTime) { ignoredDates.push(sentence.slice(0, 220)); continue; }
    const dates = [...sentence.matchAll(/(?:(20\d{2})[年./-])?(\d{1,2})[月./-](\d{1,2})日?(?:(\d{1,2})(?:[:：时点])(\d{2})?分?)?/g)];
    if (!dates.length) continue;
    const sentenceYear = dates.find(d => d[1])?.[1] || year;
    if (/开始受理|开始申报|开放申报|申报开始时间|申请开始时间/.test(sentence) && !/截止|截至/.test(sentence) && dates.length === 1 && sentenceYear) {
      const d=dates[0], start=`${d[1] || sentenceYear}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`;
      if (deadlineInstant(start)) openings.push(start);
      continue;
    }
    const isRange = dates.length >= 2 && /(?:至|到|—|~|～|-)/.test(sentence.slice(dates[0].index + dates[0][0].length, dates[1].index));
    const closing = /截止|截至|受理时间|申报时间|申请时间|申领时间|报送时间|填报时间|提交时间|前(?:完成|提交|报送|申报|推荐|登录|将|$)/.test(sentence) || /日(?:\d{1,2}[:：时]\d{0,2})?前/.test(sentence) || isRange && /(?:企业|申报单位).{0,150}(?:提交|登录|填报|报送).{0,80}(?:材料|平台|系统|申请)/.test(sentence);
    if (!closing) continue;
    const targets = isRange ? dates.slice(1) : dates;
    for (const d of targets) {
      const y = d[1] || sentenceYear;
      if (!y) continue;
      const date = `${y}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
      const time = d[4] ? `${d[4].padStart(2, "0")}:${(d[5] || "00").padStart(2, "0")}` : "";
      if (!deadlineInstant(date, time)) continue;
      const prefix = sentence.slice(Math.max(0, d.index - 180), d.index);
      if (/开始时间|开放时间/.test(prefix) && !isRange && !/截止|截至/.test(prefix)) continue;
      const role = /(?:请各|各县|各设区市|各地|各科技主管|推荐单位|区县初审).{0,150}(?:部门|科技局|工信局|审核|推荐|汇总)|(?:科技局|工信局|主管部门|推荐单位)[^。；]{0,40}$/.test(prefix) && !/(?:企业|申报单位)(?:须|应|请)?于$/.test(prefix) ? "recommendation" : "applicant";
      const start = isRange && sentenceYear ? `${dates[0][1] || sentenceYear}-${dates[0][2].padStart(2, "0")}-${dates[0][3].padStart(2, "0")}` : "";
      windows.push({ date, time, start, role, batch: sentence.match(/第[一二三四五六123456]批|首批|后续批次/)?.[0] || "", firstBatch: /首批|第一批/.test(sentence), excerpt: sentence.slice(0, 450), source: "content" });
    }
  }
  const explicit = (policy.applicationWindows || []).filter(w => deadlineInstant(w.date, w.time));
  windows.push(...explicit);
  // An index deadline is a fallback only; body evidence has the applicable stage.
  if (!windows.length && /截止|最近要求|申报期限/.test(policy.deadlineEvidence || "") && deadlineInstant(policy.deadline, policy.deadlineTime)) windows.push({ date: policy.deadline, time: policy.deadlineTime || "", role: "applicant", source: "official_index", excerpt: policy.deadlineEvidence });
  const unique = [...new Map(windows.map(w => [`${w.date}|${w.time}|${w.role}`, w])).values()];
  const rolling = /(?:常年|全年|常态化|随时|长期)(?:开放|开展|受理|申报|接受)|随报随审/.test(text);
  const applicant = unique.filter(w => w.role !== "recommendation" && !(rolling && w.firstBatch && deadlineInstant(w.date, w.time) < now));
  const distinctBatches = new Set(applicant.map(w => w.batch).filter(Boolean));
  const activeBatches = distinctBatches.size > 1 && applicant.every(w => w.batch) ? applicant.filter(w => deadlineInstant(w.date, w.time) >= now) : applicant;
  const selected = (activeBatches.length ? activeBatches : applicant).sort((a, b) => +deadlineInstant(a.date, a.time) - +deadlineInstant(b.date, b.time))[0];
  const recommendationClosed = !rolling && unique.length > 0 && unique.every(w => deadlineInstant(w.date, w.time) < now);
  if (selected && !selected.start && openings.length === 1) selected.start = openings[0];
  const status = selected ? +deadlineInstant(selected.date, selected.time) < +now ? "expired" : selected.start && +new Date(`${selected.start}T00:00:00+08:00`) > +now ? "upcoming" : "open" : rolling ? "ongoing" : recommendationClosed ? "expired" : "unknown";
  return { applicationWindowStatus: status, deadlineDate: selected?.date || "", deadlineTime: selected?.time || "", daysLeft: selected ? Math.ceil((+deadlineInstant(selected.date, selected.time) - +now) / 86400000) : null, applicationWindows: unique, ignoredDates, deadline: { found: Boolean(selected), citations: selected ? [{ source: selected.source, term: selected.date, excerpt: selected.excerpt }] : [] } };
}

export function displayPolicyTime(policy, now = new Date()) {
  const timing = policy.timing || {};
  // A stale raw index date must not contradict a reviewed unknown/rolling window.
  if (timing.applicationWindowStatus === 'unknown') return {label:'',tone:'unknown',date:'',time:''};
  if (timing.applicationWindowStatus === 'ongoing') return {label:'常年受理',tone:'open',date:'',time:''};
  const date = timing.deadlineDate || policy.deadline || "";
  const time = timing.deadlineTime || policy.deadlineTime || "";
  const end = deadlineInstant(date, time);
  if (end) {
    const days = Math.ceil((+end - +now) / 86400000);
    if (end < now) return { label: "已截止", tone: "closed", date, time };
    if (timing.applicationWindowStatus === "upcoming") return { label: "即将开放", tone: "unknown", date, time };
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(now);
    return { label: date === today ? "今日截止" : `剩余 ${days} 天`, tone: days <= 7 ? "soon" : "open", date, time };
  }
  // No raw enum or speculative date in the interface.
  return { label: "", tone: "unknown", date: "", time: "" };
}
