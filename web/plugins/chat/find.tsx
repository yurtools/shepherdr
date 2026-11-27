// Find occurrences in the actual mounted conversation, not one hit per
// message or a second approximate Markdown parser. Range highlights preserve
// rendered markup, code and exact Copy. The native view shares literal ranges.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { act, getState, setUI, useStore, useUI } from '@client/kernel.ts'
import { WORDS } from './rows.tsx'
import { DownIcon, ic, IconButton, roundBtn, SearchIcon, XIcon } from '@client/ui.tsx'
import { findPosition, findStep } from '@core/chat-find.js'
import { clearFind, FIND_LIMITS, findRows, paintFind, scanFindRow, scrollToRange, type FindHit } from './find-dom.ts'

export function openFind(chat: string) {
  const state=getState(), f=state.ui.find
  const historyKey=state.chats[chat]?.historyKey
  if (f?.chat === chat && f.historyKey === historyKey) {
    const fields=Array.from(document.querySelectorAll<HTMLInputElement>(`input[name=find][data-chat="${CSS.escape(chat)}"]`))
    fields.find(el=>el.getClientRects().length)?.focus({ preventScroll: true })
    return
  }
  setUI({ find: { chat, q: '', id: null, historyKey }, menu: false, taskMenu: false, plus: null, pick: null })
}
export function closeFind() {
  const chat = getState().ui.find?.chat
  setUI({ find: null })
  if(chat){
    const scope=document.activeElement?.closest('[data-drop]')
    const selector=`textarea[name=message][data-chat="${CSS.escape(chat)}"]`
    const box=scope?.querySelector<HTMLTextAreaElement>(selector)??Array.from(document.querySelectorAll<HTMLTextAreaElement>(selector)).find(el=>el.getClientRects().length)
    box?.focus({preventScroll:true})
  }
}

type Index = { q: string; hits: FindHit[]; limited: boolean }
const empty: Index = { q: '', hits: [], limited: false }

export function FindBar({ chatKey }: { chatKey: string }) {
  const stored = useUI(u => u.find?.chat === chatKey ? u.find : null)
  const historyKey = useStore(s => s.chats[chatKey]?.historyKey)
  const f = stored && (!stored.historyKey || !historyKey || stored.historyKey === historyKey) ? stored : null
  useLayoutEffect(()=>{if(stored&&!f)setUI(u=>u.find===stored?{find:null}:{})},[stored,f])
  const earlier = useStore(s => !!s.chats[chatKey]?.earlier)
  const historyLimited = useStore(s => !!s.chats[chatKey]?.historyLimited)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState(false)
  const input = useRef<HTMLInputElement>(null), owner = useRef({}), jumped = useRef('')
  const [index, setIndex] = useState<Index>(empty)
  const q = f?.q.trim() ?? ''
  const hits = index.q === q ? index.hits : []
  const pos = findPosition(hits, f?.id ? { id: f.id, part: f.part ?? 0, start: f.start ?? 0 } : null)
  const active = hits[pos]
  const root = () => input.current?.closest<HTMLElement>('[data-drop]')
  useLayoutEffect(() => { if (f) input.current?.focus({ preventScroll: true }) }, [!!f, chatKey])

  useLayoutEffect(() => {
    const token = owner.current
    const el = root()
    jumped.current = ''
    if (!f || !q || !el) { setIndex(empty); clearFind(token); return }
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, running = false, dirty = false
    type RowResult = ReturnType<typeof scanFindRow>
    const cache = new WeakMap<HTMLElement, RowResult>()
    let rows: HTMLElement[] = [], at = 0, found: { row: HTMLElement; data: RowResult }[] = [], count=0, limited = false
    const run = () => {
      timer = undefined
      if (cancelled) return
      const deadline = performance.now() + 7
      // Limit each browser turn even for a very large retained history.
      for (let n = 0, parsed=0; at < rows.length && n < 160 && parsed<24 && (n === 0 || performance.now() < deadline); n++, at++) {
        const row = rows[at]
        if (!row.isConnected) { dirty = true; continue }
        if(count>=FIND_LIMITS.matches){limited=true;at=rows.length;break}
        let got=cache.get(row)
        if(!got){parsed++;got=scanFindRow(row,q,FIND_LIMITS.matches);cache.set(row,got)}
        found.push({row,data:got});count+=got.hits.length;limited ||= got.limited
      }
      if (at < rows.length) { timer = setTimeout(run, 0); return }
      running = false
      if (cancelled) return
      // An affected DOM row may have changed in the middle of a large search.
      // Don't publish ranges from the obsolete text; finish the queued pass.
      if(dirty){schedule();return}
      const hits:FindHit[]=[]
      for(const {row,data} of found){
        if(!row.isConnected||cache.get(row)!==data)continue
        for(const h of data.hits){
          if(hits.length>=FIND_LIMITS.matches){limited=true;break}
          if(h.range.startContainer.isConnected&&h.range.endContainer.isConnected)hits.push(h)
        }
      }
      setIndex({ q, hits, limited })
    }
    const begin = () => { timer = undefined; running = true; dirty = false; rows = findRows(el, chatKey); at = 0; found = []; count=0; limited = false; run() }
    const schedule = () => {
      if (cancelled) return
      if (running) { dirty = true; return }
      if (timer === undefined) timer = setTimeout(begin, 30)
    }
    const observer = new MutationObserver(changes => {
      let changed=false
      for(const c of changes){
        const target=c.target instanceof Element?c.target:c.target.parentElement
        if(!target?.closest('[data-messages]'))continue
        const row=target.closest<HTMLElement>('[data-whole]')??target.closest<HTMLElement>('[data-msg]')
        const image=target.closest<HTMLElement>('[data-find-row]');if(image)cache.delete(image)
        if(row)cache.delete(row)
        changed=true
      }
      if(changed)schedule()
    })
    observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-find-ignore'] })
    begin()
    return () => { cancelled = true; clearTimeout(timer); observer.disconnect(); clearFind(token) }
  }, [!!f, q, chatKey])

  // Keep the active hit by message + text range when new pages or streamed
  // replies change the count. Don't jump again just because the count changed.
  useLayoutEffect(() => {
    if (!f || !q || index.q !== q) return
    if(!input.current?.getClientRects().length)return
    paintFind(owner.current, hits, active)
    if (!active) return
    if (f.id !== active.id || f.part !== active.part || f.start !== active.start) {
      setUI({ find: { ...f, id: active.id, part: active.part, start: active.start } })
    }
    const key = JSON.stringify([chatKey, q, active.id, active.part, active.start])
    if (jumped.current === key) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const el = root()
        if (el && scrollToRange(active.range, el)) jumped.current = key
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [f, q, index, pos, chatKey])

  const step = (by: 1 | -1) => {
    const h = hits[findStep(pos, hits.length, by)]
    if (h && f) setUI({ find: { ...f, id: h.id, part: h.part, start: h.start } })
  }
  useEffect(()=>{
    const el=root();if(!f||!el)return
    const key=(e:KeyboardEvent)=>{if(e.key==='F3'){e.preventDefault();e.stopPropagation();step(e.shiftKey?-1:1)}}
    el.addEventListener('keydown',key,true);return ()=>el.removeEventListener('keydown',key,true)
  },[f,index,pos])
  if(!f)return null
  const load = async () => {
    setLoading(true); setFailure(false)
    try { await act({ type: 'earlier', chat: chatKey } as never) } catch { setFailure(true) }
    finally { setLoading(false) }
  }
  return (
    <div className="mx-auto w-full max-w-read shrink-0 px-3 pt-2 phone:px-2">
      <div role="search" className="round-box flex flex-col gap-0.5 bg-bg p-1.5 shadow-box has-[input:focus]:shadow-box-focus">
        <div className="flex min-w-0 items-center gap-1 pl-1.5">
          <SearchIcon className={`${ic} shrink-0 text-fg3`} />
          <input ref={input} name="find" data-chat={chatKey} type="search" aria-label={WORDS.find} placeholder={WORDS.find}
            autoComplete="off" enterKeyHint="search" value={f.q}
            onChange={e => setUI({ find: { chat: chatKey, q: e.target.value, id: null, historyKey } })}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.nativeEvent.isComposing) step(e.shiftKey ? -1 : 1) }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind() }
            }}
            className="h-[34px] min-w-0 flex-1 bg-transparent px-1 outline-none placeholder:text-fg3 phone:h-11 phone:text-[1rem] [&::-webkit-search-cancel-button]:hidden" />
          {q ? <span role="status" className="shrink-0 px-1 text-[0.75rem] whitespace-nowrap text-fg2 tabular-nums phone:text-[0.8125rem]">
            {index.q !== q ? 'Searching…' : hits.length ? `${pos + 1} of ${hits.length}${index.limited ? '+' : ''}` : WORDS.noMatches}
          </span> : null}
          <IconButton label="Previous match" disabled={hits.length < 2} className={roundBtn} onClick={() => step(-1)}><DownIcon className={`${ic} rotate-180`} /></IconButton>
          <IconButton label="Next match" disabled={hits.length < 2} className={roundBtn} onClick={() => step(1)}><DownIcon className={ic} /></IconButton>
          <IconButton label="Close search" className={roundBtn} onClick={closeFind}><XIcon className={ic} /></IconButton>
        </div>
        {earlier || index.limited || failure ? <div className="flex min-w-0 items-center gap-2 px-2 pb-1 text-[0.75rem] text-fg3">
          <span className="min-w-0 flex-1">{failure ? 'Could not load earlier history.' : index.limited ? 'Search limit reached; results are partial.' : 'Only loaded history is searched.'}</span>
          {earlier ? <button type="button" disabled={loading || historyLimited} onClick={() => void load()} className="shrink-0 rounded-md px-2 py-1 text-fg2 hover:bg-hover phone:py-2">
            {historyLimited ? 'History limit' : loading ? 'Loading…' : WORDS.searchEarlier}
          </button> : null}
        </div> : null}
      </div>
    </div>
  )
}
