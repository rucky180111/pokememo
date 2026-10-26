import {useApp} from './common.jsx';
import {JSONExport} from './json-export.jsx';

export function BattleExport({id}) {
  const {store} = useApp();
  const file = () => {
    const data = store.exportBattle(id), b = data.battles[0];
    const date = (b.date || data.exportedAt.slice(0, 10)).replace(/[^0-9-]/g, '');
    const safeId = b.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return new File([JSON.stringify(data, null, 2)], `pokememo-battle-${date}-${safeId}.json`, {type: 'application/json'});
  };
  return <JSONExport label="書き出し" title="この対戦を書き出す" makeFile={file}>
    <p>この対戦1件のパーティ・選出・ログ・推定データ・メモをJSONファイルに保存します。ほかの対戦や同期設定は含みません。</p>
  </JSONExport>;
}
