import {useState} from 'preact/hooks';
import {useApp, Sheet} from './common.jsx';

// ファイルは保存・共有ボタンを押した時点の最新データから作る。
export function JSONExport({label, title, makeFile, children, class: cls = 'btn ghost sm'}) {
  const {toast} = useApp();
  const [open, setOpen] = useState(false);
  let canShare = false;
  try { canShare = !!navigator.canShare?.({files: [new File(['{}'], 'data.json', {type: 'application/json'})]}); } catch {}
  const download = () => {
    try {
      const f = makeFile(), a = document.createElement('a');
      const url = URL.createObjectURL(f);
      a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setOpen(false);
    } catch (e) { toast(`書き出せませんでした: ${e.message}`); }
  };
  const share = async () => {
    try { await navigator.share({files: [makeFile()], title}); setOpen(false); }
    catch (e) { if (e.name !== 'AbortError') toast(`共有できませんでした: ${e.message}`); }
  };
  return <>
    <button class={cls} onClick={() => setOpen(true)} aria-label={title}>{label}</button>
    {open && <Sheet title={title} onClose={() => setOpen(false)}>
      {children}
      <p class="hint">読み込み直すときは「設定」のデータ読み込みから取り込めます。相手の名前やメモも含まれます。</p>
      <div class="btnrow"><button class="btn primary" onClick={download}>JSONファイルを保存</button>{canShare && <button class="btn" onClick={share}>共有する</button>}</div>
    </Sheet>}
  </>;
}
