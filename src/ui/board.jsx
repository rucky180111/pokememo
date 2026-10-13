// ダメージの帯 (ダメージ表・右側のダメージ欄で共用)
import {cx} from './common.jsx';
import {dmgClass} from './battle.jsx';

// 残りHPに対するダメージの帯: 濃い部分 = 最大ダメージ後も残るHP、薄い部分 = 乱数の幅
export function DmgBar({r, hp}) {
  if (!r?.ok || r.status) return <span class="dbar none" />;
  const lo = Math.max(0, hp - r.maxPct), hi = Math.max(0, hp - r.minPct);
  return (
    <span class="dbar" aria-hidden="true">
      <span class="d-left" style={{width: `${lo}%`}} />
      <span class="d-roll" style={{width: `${hi - lo}%`}} />
      <span class={cx('d-dmg', dmgClass(r))} style={{width: `${Math.max(0, hp - hi)}%`}} />
    </span>
  );
}
