import {StepRange} from './step-range.jsx';

// HPの入力は盤面・補正・ログ修正で共通。空欄と実測値を混同しない。
export function HPInput({label, visibleLabel = label, sliderLabel = `${label}の調整`, buttonLabel = label, value, current = 100, max = 100, unit = '%', onChange}) {
  const shown = value == null ? null : Math.round(value);
  const anchor = shown ?? Math.round(current);
  const change = n => onChange(n == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(max, n)));
  return <div class="hp-control">
    <div class="hp-control-row">
      <label><span>{visibleLabel}</span><span class="hp-number"><input class="input num" aria-label={label} type="number" inputMode="none" min="0" max={max} step="1" placeholder="未入力" value={shown ?? ''} onInput={e => change(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />{shown != null && <button type="button" class="hp-clear" aria-label={`${label}を未入力に戻す`} onClick={() => change(null)}>×</button>}</span></label>
      <span class="hp-unit">{unit}</span>
      <button class="btn" aria-label={`${buttonLabel}を1減らす`} disabled={anchor <= 0} onClick={() => change(anchor - 1)}>−</button>
      <button class="btn" aria-label={`${buttonLabel}を1増やす`} disabled={anchor >= max} onClick={() => change(anchor + 1)}>＋</button>
    </div>
    <StepRange buttons={false} value={anchor} max={max} label={sliderLabel} onChange={change} />
  </div>;
}
