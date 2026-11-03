import {parseCond} from '../engine/pickrule.js';
import {speciesName,selectionSpeciesId} from '../engine/dex.js';
import {Sprite,TypeChip,cx} from './common.jsx';
// 条件をアイコンで表示: ポケモンはアイコン、タイプはタイプ表示。+ は「かつ」、| は「か」、/ は「または」
export function CondIcons({cond, preview = false, anyLabel = 'どれにも当てはまらないとき'}) {
  const c = typeof cond === 'string' ? parseCond(cond) : cond;
  if (c.any) return <span class="pr-cond"><span class="pr-any">{anyLabel}</span></span>;
  if (!c.alts.length) return <span class="pr-cond muted">(条件なし)</span>;
  const atom = a => a.type ? <TypeChip type={a.type} small />
    : <span class="pr-mon" title={speciesName(preview ? selectionSpeciesId(a.show) : a.show)}><Sprite id={preview ? selectionSpeciesId(a.show) : a.show} size={30} fallback={<span class="pr-fb">{speciesName(preview ? selectionSpeciesId(a.show) : a.show)}</span>} /></span>;
  return (
    <span class="pr-cond">
      {c.alts.map((terms, ai) => <>
        {ai > 0 && <span class="pr-op pr-or">または</span>}
        {terms.map((t, ti) => <>
          {ti > 0 && <span class="pr-op">＋</span>}
          <span class={cx('pr-term', t.neg && 'neg', t.any.length > 1 && 'multi')}>
            {t.any.length > 1 && <span class="pr-min">{t.min > 1 ? `${t.min}体以上` : 'どれか'}</span>}
            {t.any.map(atom)}
            {t.neg && <span class="pr-neg">いない</span>}
          </span>
        </>)}
      </>)}
    </span>
  );
}

