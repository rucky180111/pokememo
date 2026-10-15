// スライダーと数値の微調整は同じ上限・下限を使う。
export function StepRange({value, min = 0, max = 100, limit = max, onChange, label, children}) {
  const upper = Math.min(max, limit);
  const change = n => onChange(Math.max(min, Math.min(upper, n)));
  return (
    <div class="step-range">
      <button class="step-btn" disabled={value <= min} onClick={() => change(value - 1)} aria-label={`${label}を1減らす`}>−</button>
      <span class="step-track">{children}<input type="range" min={min} max={max} step={1} value={value} aria-label={label}
        onInput={e => { const next = Math.max(min, Math.min(upper, Number(e.currentTarget.value))); e.currentTarget.value = String(next); change(next); }} /></span>
      <button class="step-btn" disabled={value >= upper} onClick={() => change(value + 1)} aria-label={`${label}を1増やす`}>＋</button>
    </div>
  );
}
