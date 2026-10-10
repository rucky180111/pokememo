// 共通の UI 部品
import {createContext} from 'preact';
import {createPortal} from 'preact/compat';
import {useContext, useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {dex, search, TYPE_JA, speciesName} from '../engine/dex.js';

export const AppCtx = createContext(null);
const DepthCtx = createContext(0);
let openSheets = 0;
const sheetStack = [];
export const useApp = () => useContext(AppCtx);

export function useStoreVersion(store) {
  const [, setV] = useState(0);
  useEffect(() => store.subscribe(setV), [store]);
}

export const cx = (...a) => a.filter(Boolean).join(' ');

export function TypeChip({type, small}) {
  return <span class={cx('type', `t-${type}`, small && 'sm')}>{TYPE_JA[type] || type}</span>;
}

export function MonName({id, sub}) {
  const s = dex.species[id];
  return (
    <span class="monname">
      <span class="nm">{speciesName(id)}</span>
      {s && sub !== false && <span class="types">{s.t.map(t => <TypeChip type={t} small />)}</span>}
    </span>
  );
}

// 画面下からせり上がるパネル
export function Sheet({title, onClose, children, wide, actions}) {
  const depth = useContext(DepthCtx);
  useEffect(() => {
    const me = {};
    sheetStack.push(me);
    // Esc はいちばん手前のパネルだけを閉じる
    const onKey = e => { if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === me) { e.stopImmediatePropagation(); onClose?.(); } };
    document.addEventListener('keydown', onKey);
    // 開いているパネルの数で背景のスクロールを止める。重ねて開いたパネルが閉じる順番に関係なく、
    // 最後の1枚が閉じたら必ずスクロールできる状態に戻す。
    openSheets++;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = sheetStack.indexOf(me); if (at >= 0) sheetStack.splice(at, 1);
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.body.style.overflow = '';
    };
  }, []);
  // 画面のどこから開いても最前面に出るよう、body 直下に描画する
  return createPortal(
    <div class="overlay" style={{zIndex: 50 + depth}} onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div class={cx('sheet', wide && 'wide')} role="dialog" aria-label={title}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <div class="sheet-actions">{actions}<button class="btn ghost" onClick={onClose} aria-label="閉じる">閉じる</button></div>
        </div>
        <div class="sheet-body"><DepthCtx.Provider value={depth + 1}>{children}</DepthCtx.Provider></div>
      </div>
    </div>,
    document.body,
  );
}

const CAT_JA = {P: '物理', S: '特殊', Z: '変化'};

/**
 * 検索して選ぶパネル。
 * kind: 'species' | 'moves' | 'items' | 'abilities'
 * rank: {id: 率} を渡すと、その順に上位表示して率を出す (使用率など)
 * prefer: 先頭に出したい id の配列 (習得技など)。preferOnly を切り替えて全件も出せる。
 */
export function Picker({kind, title, onPick, onClose, filter, rank, prefer, preferLabel, allowClear, clearLabel}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(!prefer);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const preferSet = useMemo(() => (prefer ? new Set(prefer) : null), [prefer]);
  const list = useMemo(() => {
    let out = search(kind, q, {limit: 0, filter: id => (!filter || filter(id)) && (all || !preferSet || preferSet.has(id))});
    if (rank && !q) {
      out = out.slice().sort((a, b) => (rank[b.id] || 0) - (rank[a.id] || 0) || a.j.localeCompare(b.j, 'ja'));
    } else if (!q) out = out.slice().sort((a, b) => a.j.localeCompare(b.j, 'ja'));
    return out.slice(0, 120);
  }, [kind, q, all, rank, preferSet, filter]);
  return (
    <Sheet title={title} onClose={onClose}>
      <div class="picker-bar">
        <input ref={ref} class="input" type="search" inputMode="search" autocomplete="off" autocapitalize="off" spellcheck={false}
          placeholder="なまえで検索 (ひらがな可)" value={q} onInput={e => setQ(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter' && list[0]) onPick(list[0].id); }} />
        {prefer && <label class="check"><input type="checkbox" checked={all} onChange={e => setAll(e.currentTarget.checked)} />{preferLabel || 'すべて表示'}</label>}
      </div>
      <div class="picker-list">
        {allowClear && !q && <button class="row" onClick={() => onPick('')}><span class="muted">{clearLabel || '(なし / 未設定)'}</span></button>}
        {list.map(e => (
          <button class="row" key={e.id} onClick={() => onPick(e.id)}>
            {kind === 'species' ? <MonName id={e.id} /> : <span class="nm">{e.j}</span>}
            <span class="row-sub">
              {kind === 'moves' && (() => { const m = dex.moves[e.id]; return <><TypeChip type={m.t} small /><span class="tag">{CAT_JA[m.c]}</span>{m.bp ? <span class="num">{m.bp}</span> : null}{m.pr ? <span class="tag">優先{m.pr > 0 ? '+' : ''}{m.pr}</span> : null}</>; })()}
              {kind === 'species' && <span class="num dim">{dex.species[e.id].bs.join('-')}</span>}
              {rank && rank[e.id] ? <span class="rate">{(rank[e.id] * 100).toFixed(0)}%</span> : null}
            </span>
          </button>
        ))}
        {!list.length && <p class="empty pad">見つかりません。{prefer && !all && <button class="btn sm" onClick={() => setAll(true)}>{preferLabel || 'すべて表示'}</button>}</p>}
      </div>
    </Sheet>
  );
}

// 選択肢を横並びのボタンで
export function Seg({value, options, onChange, small, wrap}) {
  return (
    <div class={cx('seg', small && 'sm', wrap && 'wrap')} role="group">
      {options.map(o => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        return <button class={cx(v === value && 'on')} aria-pressed={v === value} onClick={() => onChange(v)}>{label}</button>;
      })}
    </div>
  );
}

export function Toggle({on, onChange, children, small, title}) {
  return <button class={cx('toggle', on && 'on', small && 'sm')} aria-pressed={!!on} title={title} onClick={() => onChange(!on)}>{children}</button>;
}

export function Stepper({value, min = -6, max = 6, onChange, label, signed}) {
  const txt = signed && value > 0 ? `+${value}` : `${value}`;
  return (
    <span class={cx('stepper', signed && value > 0 && 'pos', signed && value < 0 && 'neg')}>
      {label && <span class="lb">{label}</span>}
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label || ''} 下げる`}>−</button>
      <span class="val num">{txt}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`${label || ''} 上げる`}>＋</button>
    </span>
  );
}

export function Empty({children}) { return <p class="empty">{children}</p>; }

export function Confirm({title, message, okLabel = 'OK', danger, onOk, onClose}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p class="pad">{message}</p>
      <div class="btnrow pad">
        <button class="btn" onClick={onClose}>やめる</button>
        <button class={cx('btn', danger ? 'danger' : 'primary')} onClick={() => { onOk(); onClose(); }}>{okLabel}</button>
      </div>
    </Sheet>
  );
}

export const fmtPct = v => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
export const rate = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
