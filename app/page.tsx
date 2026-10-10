"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, CheckCircle2, CircleHelp, FileUp, GraduationCap, RotateCcw, Sparkles, Target, XCircle } from "lucide-react";

type Q = { id: number; subject: string; grade: string; unit: string; question: string; options: string[]; answer: number; explanation: string };
type Attempt = { id: number; choice: number; correct: boolean; date: string };
const QUESTIONS: Q[] = [
  {id:1,subject:"數學",grade:"小四",unit:"角度",question:"一個平角是多少度？",options:["90°","180°","270°","360°"],answer:1,explanation:"平角形成一直線，大小為 180°。"},
  {id:2,subject:"數學",grade:"小四",unit:"角度",question:"一個周角相當於幾個平角？",options:["1 個","2 個","3 個","4 個"],answer:1,explanation:"周角 360°，平角 180°，所以是 2 個。"},
  {id:3,subject:"國語",grade:"小四",unit:"詞語",question:"「迅速」最接近下列哪個詞語？",options:["緩慢","快速","安靜","遙遠"],answer:1,explanation:"迅速與快速都有動作很快的意思。"},
  {id:4,subject:"英文",grade:"小四",unit:"單字",question:"Which word means「結果」？",options:["result","reason","review","return"],answer:0,explanation:"result 是「結果」；reason 是「原因」。"},
  {id:5,subject:"數學",grade:"小五",unit:"分數",question:"1/2 + 1/4 = ?",options:["1/4","2/6","3/4","1"],answer:2,explanation:"1/2 = 2/4，2/4 + 1/4 = 3/4。"},
  {id:6,subject:"數學",grade:"小四",unit:"角度",question:"直角加上平角等於幾度？",options:["180°","225°","270°","360°"],answer:2,explanation:"直角 90° + 平角 180° = 270°。"}
];
const KEY = "lerniqa-demo-attempts-v1";

export default function Home() {
  const [grade,setGrade] = useState("小四");
  const [subject,setSubject] = useState("全部");
  const [exam,setExam] = useState("第一次定期評量");
  const [examDate,setExamDate] = useState("");
  const [attempts,setAttempts] = useState<Attempt[]>([]);
  const [selected,setSelected] = useState<Record<number,number>>({});
  const [tab,setTab] = useState<"practice"|"mistakes"|"import">("practice");
  const [fileNames,setFileNames] = useState<string[]>([]);

  useEffect(()=>{try {const stored = JSON.parse(localStorage.getItem(KEY)||"[]");if(Array.isArray(stored))setAttempts(stored.filter((v)=>typeof v.id==="number" && typeof v.correct==="boolean" && typeof v.date==="string"));}catch{}},[]);
  const filtered = useMemo(()=>QUESTIONS.filter(q=>q.grade===grade&&(subject==="全部"||q.subject===subject)),[grade,subject]);
  const latest = useMemo(()=>{const map=new Map<number,Attempt>();for(const a of attempts)map.set(a.id,a);return map},[attempts]);
  const mistakes = filtered.filter(q=>latest.get(q.id)?.correct===false);
  const finished = filtered.filter(q=>latest.has(q.id)).length;
  const correct = filtered.filter(q=>latest.get(q.id)?.correct).length;
  const showQuestions=tab==="mistakes"?mistakes:filtered;
  function submit(q:Q) {const choice=selected[q.id];if(choice===undefined)return;const next=[...attempts,{id:q.id,choice,correct:choice===q.answer,date:new Date().toISOString()}];setAttempts(next);localStorage.setItem(KEY,JSON.stringify(next));setSelected(p=>{const n={...p};delete n[q.id];return n});}
  function reset() {if(!window.confirm("要清除這個瀏覽器中的示範作答紀錄嗎？"))return;setAttempts([]);localStorage.removeItem(KEY);}
  const card="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><div className="rounded-2xl bg-indigo-600 p-3 text-white"><GraduationCap size={30}/></div><div><h1 className="text-3xl font-extrabold tracking-tight">Lerniqa <span className="text-indigo-600">學睿卡</span></h1><p className="text-sm text-slate-500">把每一次練習，變成真正的進步</p></div></div>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">MVP 示範版 · 僅本機儲存</span>
    </header>
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <label className={card+" text-sm font-medium"}>年級<select aria-label="年級" className="mt-2 w-full rounded-lg border p-2" value={grade} onChange={e=>setGrade(e.target.value)}><option>小四</option><option>小五</option></select></label>
      <label className={card+" text-sm font-medium"}>科目<select aria-label="科目" className="mt-2 w-full rounded-lg border p-2" value={subject} onChange={e=>setSubject(e.target.value)}><option>全部</option><option>數學</option><option>國語</option><option>英文</option></select></label>
      <label className={card+" text-sm font-medium"}>考試範圍<select aria-label="考試範圍" className="mt-2 w-full rounded-lg border p-2" value={exam} onChange={e=>setExam(e.target.value)}><option>第一次定期評量</option><option>第二次定期評量</option><option>第三次定期評量</option><option>平時練習</option></select></label>
    </div>
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      <div className={card}><div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><BookOpen size={16}/>本範圍示範題數</div><strong className="text-3xl">{filtered.length}</strong></div>
      <div className={card}><div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><CheckCircle2 size={16}/>最近一次答對</div><strong className="text-3xl">{correct} <span className="text-sm font-normal text-slate-400">/ 已做 {finished}</span></strong></div>
      <div className={card}><div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><Target size={16}/>待加強錯題</div><strong className="text-3xl text-rose-600">{mistakes.length}</strong></div>
    </div>
    <section className={card+" mb-5 flex flex-wrap items-center gap-3"}>
      <CalendarDays size={18} className="text-indigo-600"/><label className="text-sm">預計考試日期 <input aria-label="預計考試日期" type="date" className="ml-2 rounded-lg border px-2 py-1" value={examDate} onChange={e=>setExamDate(e.target.value)}/></label><span className="text-xs text-slate-500">範圍：{exam}（此設定目前僅供畫面操作）</span>
    </section>
    <nav aria-label="功能選單" className="mb-5 flex flex-wrap gap-2">
      {([{key:"practice",label:"開始練習",Icon:BookOpen},{key:"mistakes",label:"我的錯題",Icon:RotateCcw},{key:"import",label:"匯入題目",Icon:FileUp}] as const).map(({key,label,Icon})=><button type="button" key={key} onClick={()=>setTab(key)} aria-current={tab===key?"page":undefined} className={"flex items-center gap-2 rounded-xl px-4 py-3 font-medium "+(tab===key?"bg-indigo-600 text-white":"bg-white text-slate-600 border border-slate-200")}><Icon size={17}/>{label}</button>)}
      <button type="button" onClick={reset} className="ml-auto flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"><RotateCcw size={14}/>清除示範紀錄</button>
    </nav>
    {tab==="import"?<section className={card+" space-y-4"}><h2 className="text-xl font-bold">拍照 / PDF 匯入</h2><p className="text-sm text-slate-600">現在只展示選取檔案流程，尚未上傳、辨識或保存圖片。正式 OCR 與題目校對功能將在下一階段開發。</p><label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50 p-10 text-center"><FileUp className="text-indigo-500" size={32}/><strong>選擇照片或 PDF</strong><span className="text-xs text-slate-500">只接受 JPG、PNG、PDF，每個檔案最多 10 MB</span><input type="file" accept="image/jpeg,image/png,application/pdf" multiple className="max-w-full text-xs" onChange={e=>{const f=Array.from(e.target.files||[]);setFileNames(f.filter(x=>x.size<=10*1024*1024&&["image/jpeg","image/png","application/pdf"].includes(x.type)).map(x=>x.name));}}/></label>{fileNames.length>0&&<div><h3 className="font-semibold">已選取（尚未處理）</h3><ul className="mt-2 list-inside list-disc text-sm">{fileNames.map((f,i)=><li key={i}>{f}</li>)}</ul></div>}</section>:
    <div className="grid gap-4">{showQuestions.length===0?<div className={card+" text-center text-slate-500"}>{tab==="mistakes"?"目前這個篩選條件沒有待複習的錯題。":"這個篩選條件目前沒有示範題目。"}</div>:showQuestions.map((q,i)=>{const previous=latest.get(q.id);return <article key={q.id} className={card}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-indigo-600">第 {i+1} 題 · {q.subject} · {q.unit}</span>{previous&&<span className={"flex items-center gap-1 text-xs "+(previous.correct?"text-emerald-700":"text-rose-600")}>{previous.correct?<CheckCircle2 size={14}/>:<XCircle size={14}/>}最近作答：{previous.correct?"答對":"答錯"} · {new Date(previous.date).toLocaleDateString("zh-TW")}</span>}</div><h2 className="mb-4 text-lg font-bold">{q.question}</h2><fieldset className="grid gap-2 sm:grid-cols-2"><legend className="sr-only">選擇答案</legend>{q.options.map((op,idx)=><label key={idx} className={"flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm "+(selected[q.id]===idx?"border-indigo-500 bg-indigo-50":"border-slate-200 hover:bg-slate-50")}><input type="radio" name={"q-"+q.id} checked={selected[q.id]===idx} onChange={()=>setSelected(p=>({...p,[q.id]:idx}))}/><span>{String.fromCharCode(65+idx)}. {op}</span></label>)}</fieldset><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={selected[q.id]===undefined} onClick={()=>submit(q)} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">送出答案</button>{previous&&<span className="text-sm text-slate-600"><CircleHelp className="mr-1 inline" size={15}/>解析：{q.explanation}</span>}</div></article>})}</div>}
    <footer className="mt-8 flex items-start gap-2 text-xs text-slate-500"><Sparkles size={15}/><span>此版題目與解析均為固定示範資料。AI 相似題生成、OCR、帳號同步及真正考試範圍管理尚未開通；請勿在測試環境輸入真實學生個資。</span></footer>
  </main>;
}
