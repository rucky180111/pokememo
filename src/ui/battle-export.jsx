import {useState} from 'preact/hooks';
import {useApp, Sheet} from './common.jsx';

export function BattleExport({id}) {
  const {store, toast} = useApp();
  const [open, setOpen] = useState(false);
  const file = () => {
    const data = store.exportBattle(id), b = data.battles[0];
    const date = (b.date || data.exportedAt.slice(0, 10)).replace(/[^0-9-]/g, '');
    const safeId = b.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new File([JSON.stringify(data, null, 2)], `pokememo-battle-${date}-${safeId}.json`, {type: 'application/json'});
  };
  let canShare = false;
  try { canShare = !!navigator.canShare?.({files: [new File(['{}'], 'battle.json', {type: 'application/json'})]}); } catch {}
  const download = () => {
    try {
      const f = file(), a = document.createElement('a');
      const url = URL.createObjectURL(f);
      a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (e) { toast(`書き出せませんでした: ${e.message}`); }
  };
  const share = async () => {
    try { await navigator.share({files: [file()], title: '対戦記録1件'}); setOpen(false); }
    catch (e) { if (e.name !== 'AbortError') toast(`共有できませんでした: ${e.message}`); }
  };
  return <>
    <button class="btn ghost sm" onClick={() => setOpen(true)} aria-label="この対戦を書き出す">書き出し</button>
    {open && <Sheet title="この対戦を書き出す" onClose={() => setOpen(false)}>
      <p>この対戦1件のパーティ・選出・ログ・推定データ・メモをJSONファイルに保存します。ほかの対戦や同期設定は含みません。</p>
      <p class="hint">読み込み直すときは「設定」のデータ読み込みから取り込めます。相手の名前やメモも含まれます。</p>
      <div class="btnrow">
        <button class="btn primary" onClick={download}>JSONファイルを保存</button>
        {canShare && <button class="btn" onClick={share}>共有する</button>}
      </div>
    </Sheet>}
  </>;
}
