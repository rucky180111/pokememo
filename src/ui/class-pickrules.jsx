import {RuleVisualEditor,CLASS_FIELDS} from './rule-visual-editor.jsx';
import {useMemo,useRef,useState} from 'preact/hooks';
import {blankClassRules,compileClassRules,evaluateClassRules,classDecisionRecord,CLASS_HEADER,CLASS_EXAMPLE} from '../engine/class-pickrule.js';
import {rulesToText,parseCond} from '../engine/pickrule.js';
import {speciesName,selectionSpeciesId,megaFormeFor} from '../engine/dex.js';
import {useApp,Sprite,Seg} from './common.jsx';
const nm=(mons,i)=>speciesName(selectionSpeciesId(mons[i]?.species));
function fileDownload(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ClassRulesEditor({team,save}){
 const {toast}=useApp();
 const [data,setData]=useState(()=>structuredClone(team.classPickRules||blankClassRules())),[settings,setSettings]=useState(()=>JSON.stringify(data.settings,null,2)),[fileError,setFileError]=useState('');const input=useRef(null);
 const check=useMemo(()=>{try{const next={...data,settings:JSON.parse(settings)};return {data:next,...compileClassRules(next,team.mons)};}catch(e){return {errors:[`設定JSON: ${e.message}`]};}},[data,settings,team.mons]);
 const update=(k,v)=>setData(d=>({...d,[k]:v}));
 const read=async e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value='';if(!f)return;try{if(f.size>2*1024*1024)throw new Error('2MB以下にしてください');let text=new TextDecoder().decode(await f.arrayBuffer());if(text.includes('\uFFFD'))text=new TextDecoder('shift_jis').decode(await f.arrayBuffer());text=text.replace(/^\uFEFF/,'');if(f.name.endsWith('.json')){const j=JSON.parse(text);if(!j||typeof j!=='object'||Array.isArray(j)||typeof j.rowsCsv!=='string')throw new Error('class方式のJSON（rowsCsvを持つオブジェクト）を選んでください');setData(j);setSettings(JSON.stringify(j.settings,null,2));}else update('rowsCsv',text);setFileError('');}catch(err){setFileError(err.message);}};
 const char=team.mons.findIndex(m=>m.species==='charizard'),gab=team.mons.findIndex(m=>m.species==='garchomp');
 const legacyAxis=char>=0&&gab>=0&&megaFormeFor(team.mons[char].species,team.mons[char].item)&&megaFormeFor(team.mons[gab].species,team.mons[gab].item)?(team.pickRules||[]).map((r,i)=>({r,i})).filter(({r})=>r.pick?.includes('charizard')&&!parseCond(r.cond).any&&!parseCond(r.cond).errors.length):[];
 const copyAxis=({r,i})=>{try{
  const config=JSON.parse(settings);const cells=[1,r.cond,'char_axis','採用','リザードン','any','必須',1,'*','','確認済み','採用方針',`利用者が優先順位CSV行${i+1}の条件文を転記。対策保証ではない`];
  const line=cells.map(x=>/[",\n\r]/.test(String(x))?'"'+String(x).replace(/"/g,'""')+'"':String(x)).join(',');
  update('rowsCsv',(data.rowsCsv||CLASS_HEADER).trimEnd()+'\n'+line);setSettings(JSON.stringify({...config,axisBranches:{charizardRuleId:'char_axis',charizard:'リザードン',garchomp:'ガブリアス',class:2}},null,2));setFileError('');
 }catch(e){setFileError(e.message);}};
 const apply=()=>{if(check.errors.length)return;const next={...check.data,updatedAt:new Date().toISOString()};save(t=>{t.classPickRules=next;t.pickRuleMode='class';});setData(next);toast('class方式のルールを保存して有効にしました');};
 return <section class="class-rules-editor">
  <p class="hint">同じclassの条件をまとめて比較します。小さいclassを優先し、候補を代替できます。</p>
  <label class="field"><span>ルールの版</span><input class="input" value={data.version||''} onInput={e=>update('version',e.currentTarget.value)}/></label>
  <div class="btnrow"><button class="btn" onClick={()=>input.current.click()}>CSV／JSONを読み込む</button><input hidden ref={input} type="file" accept=".csv,.tsv,.json" onChange={read}/><button class="btn" disabled={!check.data||!!check.errors.length} onClick={()=>fileDownload(JSON.stringify(check.data,null,2),'pokememo-class-rules.json','application/json')}>JSONを書き出す</button><button class="btn" onClick={()=>fileDownload(data.rowsCsv||CLASS_HEADER,'pokememo-class-rules.csv','text/csv;charset=utf-8')}>CSVを書き出す</button></div>
  <p class="hint">CSVは行データ、JSONは設定・版も含む形式です。</p>
  <RuleVisualEditor text={data.rowsCsv} header={CLASS_HEADER} fields={CLASS_FIELDS} mons={team.mons} kind="class" title="class条件" csvLabel="classルールCSV" onChange={v=>update('rowsCsv',v)}/>
  <details><summary>軸分岐の設定</summary><label class="field"><span>設定JSON（軸分岐は明示設定したときだけ使用）</span><textarea class="input assessment-source" rows={5} spellcheck={false} value={settings} onInput={e=>setSettings(e.currentTarget.value)}/></label></details>
  <details><summary>入力例と各列の意味</summary>
   <p>候補は <b>ゴリランダー;ドドゲザン</b> と記入します。any＝どちらか1匹、all＝両方必要。採用では先発を指定しません。除外のallは同時選出禁止です。</p>
   <p>確認済みだけが役割の対応として数えられます。条件は相手6体、対応条件は候補が担当できる追加条件。前提役割IDは上位classの採用が成立した場合だけ有効。対面処理と後出しは別の役割IDにしてください。</p>
   <pre class="class-example">{CLASS_EXAMPLE}</pre><button class="btn" onClick={()=>update('rowsCsv',CLASS_EXAMPLE)}>未評価の入力例を編集欄へ</button>
   <p>例は未検証です。重要度1は件数を等しく比較する入力例で、適性・勝率ではありません。実際の対応可否を確認し、利用者の判断で検証欄・条件・重要度を編集してください。</p>
   <details><summary>軸分岐と前提の設定</summary><p>リザ軸を使う場合は、優先順位CSVの厳しい条件をそのままclass1・必須・確認済み・採用方針の1行へ転記します。条件をこちらで緩める処理はありません。役割IDをchar_axisとした場合の軸設定例：</p>
   <pre class="class-example">{'{"maxSelectedMegaHolders":1,"axisBranches":{"charizardRuleId":"char_axis","charizard":"リザードン","garchomp":"ガブリアス","class":2}}'}</pre>
   <p>この設定によりclass1成立時はリザ採用・ガブ除外、不成立時はガブ軸とメガなしの完成した3体を比較します。メガなしはポケモン名ではありません。</p>
   <p>条件付きリザをclass3の役割に加える場合は、同じ役割IDで候補リザードンの行を追加し、前提役割IDにchar_axisを指定します。ゴリランダーの行とは候補・対応条件・前提だけを変えられます。</p>
   </details><p>必須の競合は候補ゼロ。推奨の不足は候補を残して表示します。対戦シミュレーション・初動の安全性・勝率は未評価です。</p>
  </details>
  <details><summary>現在の優先順位CSVを参照（自動変換しません）</summary><pre class="class-example">{rulesToText(team.pickRules||[])}</pre>{legacyAxis.map(x=><button class="btn" disabled={!!check.groups?.some(g=>g.id==='char_axis')} onClick={()=>copyAxis(x)}>優先順位CSV行{x.i+1}のリザ条件をclass1へ転記（保存は別）</button>)}{legacyAxis.length>0&&<p class="hint">転記するのは条件文そのものとリザ採用・ガブ排他の軸設定です。優先順位CSVの他行や他の除外指定は変換しません。転記後の全体を確認してから保存してください。</p>}</details>
  {fileError&&<p role="alert">{fileError}</p>}{check.errors.length?<div role="alert"><b>保存できません</b><ul>{check.errors.map(e=><li>{e}</li>)}</ul></div>:<p class="hint">{check.groups.length}役割・{check.rows.length}行。形式確認済みです。</p>}
  <div class="btnrow"><button class="btn primary" disabled={!!check.errors.length} onClick={apply}>保存してclass方式を有効にする</button><button class="btn" onClick={()=>{save(t=>{t.pickRuleMode='legacy';});toast('優先順位を有効にしました');}}>優先順位を使う</button></div>
  {team.classPickRules&&<p class="hint">保存版 {team.classPickRules.version} ／ 更新 {new Date(team.classPickRules.updatedAt).toLocaleString('ja-JP')}</p>}
 </section>;
}
function Reasons({c,mons,best}){
 const covered=c.coverage,reference=best.coverage;
 return <div>
  <p>軸：{c.branch}。初動・交代で安全に受けられるか・相手先発への行動評価：未評価。</p>
  <p>上位案との違い：追加で担当 {covered.filter(id=>!reference.includes(id)).join('・')||'なし'} ／ 上位案のみ担当 {reference.filter(id=>!covered.includes(id)).join('・')||'なし'}</p>
  {c.classResults.map(r=><p><b>class{r.class}</b> 充足 {r.covered.length}件 ／ 不足 {r.missingCount}件・重要度 {r.missingWeight}</p>)}
  <div class="scroll-x"><table class="assessment-table"><thead><tr><th>class・条件／役割</th><th>候補と担当</th><th>結果</th></tr></thead><tbody>{c.details.map(g=>g.id==='__axis_choice'?<tr><th>class2 軸選択</th><td>{c.branch}。補完後の3体で比較。</td><td>分岐を充足</td></tr>:<tr><th>class{g.class} {g.id}<small>{g.action}・{g.required?'必須':'推奨'}・{g.kind}・{g.mode}</small>{g.reasons.map(r=><small>条件：{r.condition}</small>)}</th><td>候補：{g.registered.map(i=>nm(mons,i)).join('／')}<br/>担当：{g.owners.map(i=>nm(mons,i)).join('／')||'なし'}{g.reasons.map(r=><small>{r.candidates.map(i=>nm(mons,i)).join('／')}：{r.verified?(r.eligible?(g.kind==='採用方針'?'採用方針を確認済み':'対応データ確認済み'):'対応条件・前提不成立'):'未評価'} ／ {r.note}{r.depends&&` ／ 前提 ${r.depends}`}{r.eligibility!=='*'&&` ／ 対応条件 ${r.eligibility}`}</small>)}</td><td>{g.satisfied?'充足':'不足'}{g.unknown.length>0&&<small>未評価候補：{g.unknown.map(i=>nm(mons,i)).join('／')}</small>}</td></tr>)}</tbody></table></div>
  {c.concentration.map(r=><p class="assessment-warning">役割集中：{nm(mons,r.mon)}に {r.roles.join('・')} の対応が依存しています。複数担当を理由に除外はしていません。</p>)}
  {c.details.filter(g=>g.action==='採用'&&g.satisfied&&g.owners.length===1).map(g=><small class="assessment-note">{g.id}の候補は{g.registered.map(i=>nm(mons,i)).join('／')}。この案では{nm(mons,g.owners[0])}が担当。</small>)}
 </div>;
}
function ClassCandidate({set,index,mons,best,started,onApply,data}){
 const [lead,setLead]=useState(null);const chosen=set.variants.find(c=>c.lead===lead);const c=chosen||set.best;
 return <article class="assessment-candidate"><header><b>{index+1}案：{set.branch}</b><span>静的な条件比較</span></header><div class="assessment-pick">{set.selected.map(i=><span><Sprite id={selectionSpeciesId(mons[i].species)} size={32}/><b>{nm(mons,i)}</b></span>)}</div>
  <p class="hint">先発は別に選択。初動は未評価です。選出案の表示順は、先発条件の不足が最も少ない案で比較しています。</p><div class="chips">{set.variants.map(v=><button class={`btn${v.lead===lead?' primary':''}`} onClick={()=>setLead(v.lead)} aria-pressed={v.lead===lead}>{nm(mons,v.lead)}を先発{v.details.some(g=>g.action==='先発'&&g.satisfied)?'（指定条件を充足）':''}</button>)}</div>
  <p>不足：{c.details.filter(g=>!g.satisfied).map(g=>`class${g.class} ${g.id}`).join('・')||(c.details.length?'登録された成立条件のみ充足（未登録の役割は未評価）':'評価できる登録条件なし（未評価）')}</p>
  {!started&&<button class="btn primary" disabled={!chosen} onClick={()=>onApply(c.pick,classDecisionRecord(data,c))}>この3体と先発を使う</button>}
  <details><summary>採用理由・担当・不足・他案との違い</summary><Reasons c={c} mons={mons} best={best}/></details>
 </article>;
}
export function ClassPickHint({data,battle,started,onApply}){
 const [branch,setBranch]=useState('すべて'),[all,setAll]=useState(false);
 const r=useMemo(()=>evaluateClassRules(data,battle.my,battle.opp),[data,battle.my,battle.opp]);
 if(battle.format==='double')return <div class="box">class方式は6体から3体を選ぶシングル用です。</div>;
 if(r.errors.length)return <div class="box" role="alert"><b>class方式を評価できません</b><ul>{r.errors.map(e=><li>{e}</li>)}</ul><p>別の方式へ自動で戻しません。構築の選出条件で設定を確認してください。</p></div>;
 const branches=[...new Set(r.sets.map(s=>s.branch))],activeBranch=branches.includes(branch)?branch:'すべて',filtered=activeBranch==='すべて'?r.sets:r.sets.filter(s=>s.branch===activeBranch);
 return <section class="box class-pick-hint"><h3>class方式の選出候補</h3><p class="hint">版 {r.version} ／ {new Date(r.updatedAt).toLocaleString('ja-JP')}。{r.sets.length}組・先発込み{r.candidates.length}候補。相手先発は未知。初動・勝率・シミュレーションは未評価です。</p>
  {r.axis&&<p>{r.charActive?'class1成立：リザードンを確保し、ガブリアスとの同時選出を除外しています。':'class1不成立：ガブ軸とメガなしの完成した3体を比較します。'}</p>}
  {!r.activeCount&&<p class="assessment-warning">成立した条件がありません。未登録の相手・役割は未評価です。</p>}
  {!!r.sets.length&&!r.allSatisfied&&<p class="assessment-warning">登録された成立条件をすべて満たす3体はありません。不足を残した候補を比較しています。</p>}
  {r.noCandidates?<div role="alert"><b>条件を満たす選出なし</b><ul>{r.noCandidates.slice(1).map(s=><li>{s}</li>)}</ul><p>必須制約は自動で解除しません。</p></div>:<>
   <Seg wrap value={activeBranch} options={['すべて',...branches].map(s=>[s,s])} onChange={s=>{setBranch(s);setAll(false);}}/>
   {(all?filtered:filtered.slice(0,3)).map((s,i)=><ClassCandidate key={s.selected.join()} set={s} index={i} mons={battle.my} best={r.sets[0].best} started={started} onApply={onApply} data={data}/>)}
   <button class="btn" onClick={()=>setAll(!all)}>{all?'上位3案へ':`全${filtered.length}案と先発候補を見る`}</button>
  </>}
  <p class="hint">初動未評価の相手：{r.unassessedOpponents.map(id=>speciesName(selectionSpeciesId(id))).join('・')}。</p>
  <p class="hint">表示していない相手・型・未登録役割の対応は未評価です。「充足」は登録された条件と確認済みデータについての静的判定であり、安全な後出しや対戦の勝利を保証しません。</p>
 </section>;
}
