import {useApp} from './common.jsx';
import {JSONExport} from './json-export.jsx';

export function TeamExport({id}) {
  const {store} = useApp();
  const records = store.battles().filter(b => b.teamId === id);
  const sim = records.filter(b => b.kind === 'sim').length;
  const file = () => {
    const data = store.exportTeam(id), t = data.teams[0];
    const date = data.exportedAt.slice(0,10);
    const name = (t.name || '構築').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,60).replace(/[. ]+$/,'') || '構築';
    const safeId = t.id.replace(/[^a-zA-Z0-9_-]/g,'_');
    return new File([JSON.stringify(data,null,2)], `pokememo-team-${name}-${date}-${safeId}.json`, {type:'application/json'});
  };
  return <JSONExport label="構築と全対戦を書き出し" title="この構築と全対戦を書き出す" makeFile={file} class="btn">
    <p><b>構築1件・対戦記録{records.length - sim}件・仮想盤面{sim}件</b>を、1つのJSONファイルに保存します。未決着の対戦も含みます。</p>
    <ul>
      <li>構築の6体・型・技・能力Pt・選出ルール・構築メモ</li>
      <li>全対戦の相手6体・相手と自分の選出・行動順・結果</li>
      <li>バトルログ・HP・状態・推定データ・対戦メモ</li>
    </ul>
    <p class="hint">構築を編集する前のパーティも各対戦の記録内に残ります。読み込み後は、このデータから戦績や対面・選出の統計を再集計できます。他の構築の対戦や同期設定は含みません。</p>
  </JSONExport>;
}
