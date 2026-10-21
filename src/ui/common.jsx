// 共通の UI 部品
import {createContext} from 'preact';
import {createPortal, useSyncExternalStore} from 'preact/compat';
import {useContext, useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {dex, search, TYPE_JA, speciesName, toID} from '../engine/dex.js';

export const AppCtx = createContext(null);
const DepthCtx = createContext(0);
let openSheets = 0;
const sheetStack = [];
export const useApp = () => useContext(AppCtx);

export function useStoreVersion(store) {
  // 初期ロードが購読開始より先に終わっても、更新を取りこぼさない。
  return useSyncExternalStore(store.subscribe, () => store.version, () => store.version);
}

export const cx = (...a) => a.filter(Boolean).join(' ');

export function TypeChip({type, small}) {
  return <span class={cx('type', `t-${type}`, small && 'sm')}>{TYPE_JA[type] || type}</span>;
}

export function MonName({id, sub, icon}) {
  const s = dex.species[id];
  return (
    <span class="monname">
      {icon ? <Sprite id={id} size={icon === true ? 40 : icon} /> : null}
      <span class="nm">{speciesName(id)}</span>
      {s && sub !== false && <span class="types">{s.t.map(t => <TypeChip type={t} small />)}</span>}
    </span>
  );
}

// 画面下からせり上がるパネル
export function Sheet({title, onClose, children, wide, actions, tall}) {
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
      <div class={cx('sheet', wide && 'wide', tall && 'tall')} role="dialog" aria-label={title}>
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
export function Picker({kind, title, onPick, onClose, filter, rank, prefer, preferLabel, allowClear, clearLabel, header, actions}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(!prefer);
  const [types, setTypes] = useState([]);
  const [cat, setCat] = useState('');
  const typed = kind === 'species' || kind === 'moves';
  // タイプ: ポケモンは2つまで (両方を持つもの)、技は1つ
  const toggleType = t => setTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : kind === 'species' ? [...prev, t].slice(-2) : [t]));
  const typeOk = id => {
    if (kind === 'species') return types.every(t => dex.species[id].t.includes(t));
    if (kind === 'moves') { const m = dex.moves[id]; return (!types.length || types.includes(m.t)) && (!cat || m.c === cat); }
    return true;
  };
  const ref = useRef(null);
  // タッチ端末は検索欄を押したときだけキーボードを開く。マウス/キーボード端末は従来どおり。
  const keyboardPointer = () => !navigator.maxTouchPoints && matchMedia('(pointer: fine)').matches && !matchMedia('(any-pointer: coarse)').matches;
  useEffect(() => { if(keyboardPointer()) ref.current?.focus({preventScroll:true}); }, []);
  const choose = id => {
    onPick(id);
    if(header) {
      setQ('');
      if(keyboardPointer()) ref.current?.focus({preventScroll:true});
      else ref.current?.blur();
    }
  };
  const preferSet = useMemo(() => (prefer ? new Set(prefer) : null), [prefer]);
  const list = useMemo(() => {
    let out = search(kind, q, {limit: 0, filter: id => (!filter || filter(id)) && (all || !preferSet || preferSet.has(id)) && typeOk(id)});
    if (rank && !q) {
      out = out.slice().sort((a, b) => (rank[b.id] || 0) - (rank[a.id] || 0) || a.j.localeCompare(b.j, 'ja'));
    } else if (!q) out = out.slice().sort((a, b) => a.j.localeCompare(b.j, 'ja'));
    return out.slice(0, types.length || cat ? 400 : 120);
  }, [kind, q, all, rank, preferSet, filter, types, cat]);
  return (
    <Sheet title={title} onClose={onClose} tall actions={actions}>
      <div class="picker-fixed">
      {header && <div class="picker-selected">{header}</div>}
      <div class="picker-bar">
        <input ref={ref} class="input" type="search" inputMode="search" autocomplete="off" autocapitalize="off" spellcheck={false}
          placeholder="なまえで検索 (ひらがな可)" value={q} onInput={e => setQ(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.isComposing && list[0]) { e.preventDefault(); choose(list[0].id); } }} />
        {prefer && <label class="check"><input type="checkbox" checked={all} onChange={e => setAll(e.currentTarget.checked)} />{preferLabel || 'すべて表示'}</label>}
      </div>
      {typed && (
        <div class="type-filter">
          <span class="muted">タイプで絞り込み{kind === 'species' ? ' (2つまで)' : ''}:</span>
          {Object.keys(TYPE_JA).filter(t => t !== 'Stellar' && t !== '???').map(t => (
            <button class={cx('tf', `t-${t}`, types.includes(t) && 'on')} aria-pressed={types.includes(t)} onClick={() => toggleType(t)}>{TYPE_JA[t]}</button>
          ))}
          {kind === 'moves' && [['P', '物理'], ['S', '特殊'], ['Z', '変化']].map(([k, l]) => <button class={cx('tf cat', cat === k && 'on')} onClick={() => setCat(cat === k ? '' : k)}>{l}</button>)}
          {(types.length > 0 || cat) && <button class="btn ghost sm" onClick={() => { setTypes([]); setCat(''); }}>解除</button>}
        </div>
      )}
      </div>
      <div class="picker-list">
        {allowClear && !q && <button class="row" onClick={() => onPick('')}><span class="muted">{clearLabel || '(なし / 未設定)'}</span></button>}
        {list.map(e => (
          <button class="row" key={e.id} onClick={() => choose(e.id)}>
            {kind === 'species' ? <span class="row-mon"><Sprite id={e.id} size={36} /><MonName id={e.id} /></span> : <span class="nm">{e.j}</span>}
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
        <button class="btn" onClick={onClose}>取消</button>
        <button class={cx('btn', danger ? 'danger' : 'primary')} onClick={() => { onOk(); onClose(); }}>{okLabel}</button>
      </div>
    </Sheet>
  );
}

export const fmtPct = v => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
export const rate = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };

// ---- ポケモンの画像 (Pokémon Showdown の公開スプライトを読み込む。設定でオフにできる) ----
const HYPHEN_NAMES = new Set(['Kommo-o', 'Hakamo-o', 'Jangmo-o', 'Ho-Oh', 'Porygon-Z', 'Ting-Lu', 'Chien-Pao', 'Wo-Chien', 'Chi-Yu']);
export function spriteIds(id) {
  const s = dex.species[id];
  if (!s) return [];
  const n = s.n;
  const at = n.indexOf('-');
  const ids = [];
  if (at > 0 && !HYPHEN_NAMES.has(n)) ids.push(`${toID(n.slice(0, at))}-${toID(n.slice(at + 1))}`, toID(n.slice(0, at)));
  else ids.push(toID(n));
  return [...new Set(ids)];
}
export function Sprite({id, size = 40, class: cls, fallback = null}) {
  const app = useApp();
  const on = app?.store?.state?.settings?.sprites !== false;
  const ids = useMemo(() => spriteIds(id), [id]);
  const [k, setK] = useState(0);
  useEffect(() => setK(0), [id]);
  if (!on || !ids.length || k >= ids.length) return fallback;
  return <img class={cx('sprite', cls)} src={`https://play.pokemonshowdown.com/sprites/gen5/${ids[k]}.png`} width={size} height={size} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onError={() => setK(k + 1)} />;
}
