import {useMemo,useRef,useState} from 'preact/hooks';
import {blankAssessment,compileAssessment,evaluateSelection,ROLE_HEADER,RISK_HEADER,CASE_HEADER} from '../engine/selection-assessment.js';
import example from '../generated/selection-example.json';
import {speciesName,selectionSpeciesId} from '../engine/dex.js';
import {decidePick,pickIndexes} from '../engine/pickrule.js';
import {Sprite,Seg,useApp} from './common.jsx';
const name=(team,i)=>speciesName(selectionSpeciesId(team.mons[i]?.species));
const points=n=>Number.isFinite(n)?Number(n.toFixed(3)).toString():'未評価';
const download=(data,filename)=>{const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);};
export function SelectionAssessmentEditor({team,save}){
 const {toast}=useApp();
 const [draft,setDraft]=useState(()=>structuredClone(team.selectionAssessment || blankAssessment())),[rulesText,setRulesText]=useState(()=>JSON.stringify(draft.rules,null,2)),[tab,setTab]=useState('rolesCsv'),[fileError,setFileError]=useState('');
 const input=useRef(null),dirty=JSON.stringify({...draft,rules:rulesText})!==JSON.stringify({...team.selectionAssessment,rules:JSON.stringify(team.selectionAssessment?.rules,null,2)});
 const check=useMemo(()=>{try{const data={...draft,rules:JSON.parse(rulesText)};return {data,result:compileAssessment(data,team)};}catch(e){return {result:{errors:[`rules.json: ${e.message}`]}};}},[draft,rulesText,team]);
 const update=(k,v)=>setDraft(d=>({...d,[k]:v}));
 const useExample=()=>{const d=structuredClone(example);setDraft(d);setRulesText(JSON.stringify(d.rules,null,2));setFileError('');};
 const readFiles=async e=>{const files=[...e.currentTarget.files];e.currentTarget.value='';try{
  const next=structuredClone(draft);let nextRules=rulesText;
  for(const f of files){if(f.size>2*1024*1024)throw new Error('各ファイルは2MBまでです');let text=new TextDecoder().decode(await f.arrayBuffer());if(text.includes('\uFFFD'))text=new TextDecoder('shift_jis').decode(await f.arrayBuffer());text=text.replace(/^\uFEFF/,'');
   if(f.name.endsWith('.json')){const j=JSON.parse(text);if(j.rolesCsv!==undefined){Object.assign(next,j);nextRules=JSON.stringify(j.rules,null,2);}else nextRules=JSON.stringify(j,null,2);}
   else {const header=text.split(/\r?\n/)[0];if(header.includes('役割ID'))next.rolesCsv=text;else if(header.includes('危険ID'))next.risksCsv=text;else if(header.includes('相手型ID'))next.openingCsv=text;else throw new Error(`${f.name}: CSVの見出しを確認してください`);}
  }
  setDraft(next);setRulesText(nextRules);setFileError('');
 }catch(err){setFileError(err.message);}};
 const apply=()=>{if(!check.data||check.result.errors.length)return;const next={...check.data,updatedAt:new Date().toISOString()};save(t=>{t.selectionAssessment=next;});setDraft(next);toast('選出評価データをまとめて保存しました');};
 return <div class="selection-editor">
  <h3>選出評価 v3</h3><p>選出3体と先発を全列挙し、役割・危険を採点します。交代後は検証済みの手動ケースを参照します。数値モデルのない初動は総合点に含めません。</p>
  <div class="btnrow"><button class="btn" onClick={()=>input.current.click()}>CSV・JSONを読み込む</button><input hidden type="file" accept=".csv,.tsv,.json" multiple ref={input} onChange={readFiles}/><button class="btn" onClick={useExample}>仕様書の見本を編集欄へ</button><button class="btn" disabled={!check.data || !!check.result.errors.length} onClick={()=>download(check.data,'pokememo-selection-v3.json')}>評価データを書き出す</button></div>
  <p class="hint">読み込みは編集欄への反映だけです。全ファイルの検証後に保存します。見本は仮評価で、自分の6体に合わせて候補を修正する必要があります。</p>
  <div class="assessment-metadata"><label class="field"><span>データ版</span><input class="input" value={draft.dataVersion} onInput={e=>update('dataVersion',e.currentTarget.value)}/></label><label class="field"><span>根拠・評価の出所</span><input class="input" value={draft.source} onInput={e=>update('source',e.currentTarget.value)}/></label></div>
  <Seg wrap value={tab} options={[['rolesCsv','役割CSV'],['risksCsv','危険CSV'],['openingCsv','初動ケースCSV'],['rules','制約JSON']]} onChange={setTab}/>
  <label class="field"><span>{({rolesCsv:ROLE_HEADER,risksCsv:RISK_HEADER,openingCsv:CASE_HEADER,rules:'rules.json'})[tab]}</span><textarea class="input assessment-source" rows={12} spellcheck={false} value={tab==='rules'?rulesText:draft[tab]} onInput={e=>tab==='rules'?setRulesText(e.currentTarget.value):update(tab,e.currentTarget.value)}/></label>
  {tab==='openingCsv'&&<p class="hint">評価を付ける行は、追加列「検証済み」にtrueと根拠が必要です。「自分条件」を追加すると選出3体でケースを限定できます。未検証・未登録は未評価。異なる型に都合のよい初手を選び分けて平均する処理は行いません。</p>}
  {fileError&&<p role="alert">{fileError}</p>}{check.result.errors.length>0?<div class="assessment-errors" role="alert"><b>保存できません</b><ul>{check.result.errors.map(e=><li>{e}</li>)}</ul></div>:<p class="hint">形式確認済み：役割{check.result.roles.length}行・危険{check.result.risks.length}行・初動ケース{check.result.cases.length}行</p>}
  <div class="btnrow"><button class="btn primary" disabled={!!check.result.errors.length} onClick={apply}>評価データをまとめて保存</button>{team.selectionAssessment&&<button class="btn" onClick={()=>{save(t=>{delete t.selectionAssessment;});toast('選出評価を解除し、従来ルールに戻しました');}}>評価を解除して従来ルールへ</button>}</div>
  {dirty&&<small class="hint">編集内容は保存ボタンを押すまで対戦へ反映されません。</small>}
  {team.selectionAssessment&&<p class="hint">保存版 {team.selectionAssessment.dataVersion} ／ 更新 {new Date(team.selectionAssessment.updatedAt).toLocaleString('ja-JP')} ／ {team.selectionAssessment.source}</p>}
 </div>;
}
function SelectionLine({candidate,team}){return <div class="assessment-pick">{candidate.pick.map((i,k)=><span><Sprite id={selectionSpeciesId(team.mons[i].species)} size={32}/><b>{name(team,i)}</b>{k===0&&<small>先発</small>}</span>)}</div>;}
function CandidateDetail({candidate:c,team}){
 return <div class="assessment-detail">
  <p>静的点 {points(c.staticScore)} ＝ 役割 {points(c.rolePoints)} − 不足 {points(c.shortfall)} − 選出危険 {points(c.pickRisk)} − 先発危険 {points(c.leadRisk)} ／ 初動・下振れ・総合点：未評価</p>
  <p>予定メガ：{c.mega.length?c.mega.map(m=>speciesName(m.forme)).join('・'):'なし'}。交代時はメガ前として扱う必要があります。</p>
  <div class="scroll-x"><table class="assessment-table"><thead><tr><th>役割</th><th>担当・補正適性</th><th>代替候補</th><th>判定・得点</th></tr></thead><tbody>{c.roles.map(g=><tr><th>{g.id}</th><td>{g.owner==null?'担当なし':name(team,g.owner)} {g.fit}</td><td>{g.alternatives.map(a=><div>{name(team,a.mon)} {a.fit}→{a.adjusted}{a.selected?'（選出）':'（選出外）'}{a.effects.map(e=><small> ／ {e.id} −{e.penalty}</small>)}{a.notes.map(n=><small class="assessment-note">{n}</small>)}</div>)}</td><td>{g.short?'対策不足':'合格'}<br/>+{points(g.points)}{g.penalty?` −${g.penalty}`:''}</td></tr>)}</tbody></table></div>
  {c.concentration.map(x=><p class="assessment-warning">役割集中：{name(team,x.mon)}が {x.roles.join('・')} の唯一の合格担当です。</p>)}
  {[...c.pickRisks,...c.leadRisks].map(r=><p class="hint">{r.scene}リスク {r.id}：{name(team,r.mon)} −{r.penalty} ／ {[...new Set(r.reasons)].join('・')}</p>)}
  <h4>相手6先発と交代後のケース</h4><p class="hint">自分の先発はこの候補で固定。以下は手動ケースの参照で、全分岐を解決する対戦AIではありません。見えていない型や裏に応じた最適手の平均は計算しません。</p>
  <div class="scroll-x"><table class="assessment-table assessment-opening"><thead><tr><th>相手先発</th><th>初手候補・型仮説</th><th>引き先</th><th>攻撃・積みの結果</th><th>次ターン・残る不安</th></tr></thead><tbody>{c.opening.flatMap(o=>(o.cases.length?o.cases:[null]).map(k=><tr><th>{speciesName(selectionSpeciesId(o.foe))}<small>{points(o.probability*100)}%<br/>{k?.verified?k.state:'未評価'}<br/>全分岐は未評価</small></th>{k?<><td><b>{k.action}</b><br/>{k.hypothesis} ／ 相手：{k.opponentAction}<small>{k.verified?'検証済みケース':'未検証の記入例'}</small></td><td>{k.to==null?'指定なし':name(team,k.to)}</td><td>{k.after||'未評価'}</td><td>{k.next||'未評価'}<small>根拠：{k.reason||'未登録'}</small></td></>:<td colSpan="4">未登録の対面です。安全な引き先とは判定していません。</td>}</tr>))}</tbody></table></div>
  <p class="hint">検証済みケースがあっても、未登録の攻撃・積み・相手の交代・型・裏は未評価です。ケースの状態を実戦勝率へ変換しません。</p>
 </div>;
}
export function SelectionAssessmentHint({team,battle,started,onApply}){
 const [all,setAll]=useState(false);
 const result=useMemo(()=>team?.selectionAssessment?evaluateSelection(team.selectionAssessment,{...team,mons:battle.my},battle.opp):null,[team,battle.my,battle.opp]);
 if(!result)return null;
 if(battle.format==='double')return <div class="box"><b>選出評価 v3</b><p>この評価は6体から3体を選ぶシングル用です。</p></div>;
 if(result.errors.length)return <div class="box" role="alert"><b>選出評価を実行できません</b><ul>{result.errors.map(e=><li>{e}</li>)}</ul><p>構築の「選出評価」で設定を確認してください。従来ルールへの自動切り替えは行いません。</p></div>;
 const legacy=team.pickRules?.length?decidePick(team.pickRules,battle.opp.map(o=>o.species),battle.my.map(m=>m.species)):null;
 return <section class="box selection-assessment"><h3>選出評価 <span class="tag">静的順位</span></h3>
  {result.activeRoleCount===0&&<p class="assessment-warning">成立した役割データが0件です。この相手への対応範囲は採点できていません。</p>}
  <p class="hint">独自スコアであり、勝率ではありません。{result.sets}組・先発込み{result.candidates.length}候補を全列挙。{result.metadata.sampleOnly?'説明用の仮点数です。 ':''}{result.totalUnavailable}</p>
  <p class="hint">データ版 {result.metadata.version} ／ {result.metadata.source} ／ 更新 {new Date(result.metadata.updatedAt).toLocaleString('ja-JP')}<br/>相手先発重み：{({uniform_assumption:'均等な仮定（実測ではありません）',manual:'手入力',measured:'実測データ'})[result.leadWeightsSource]}。相手の持ち物・型を確定しません。</p>
  {result.noCandidates?<div role="alert"><b>条件を満たす選出なし</b><ul>{result.noCandidates.slice(1).map(s=><li>{s}</li>)}</ul><p>制約は自動で緩めません。</p></div>:<>
   <p>1位と2位の静的点差：{points(result.gap)}</p>
   {(all?result.candidates:result.candidates.slice(0,3)).map((c,i)=><article class="assessment-candidate"><header><b>{i+1}位</b><strong>{points(c.staticScore)}点</strong></header><SelectionLine candidate={c} team={{...team,mons:battle.my}}/>{!started&&<button class="btn primary" onClick={()=>onApply(c.pick,{schemaVersion:3,dataVersion:result.metadata.version,updatedAt:result.metadata.updatedAt,source:result.metadata.source,pick:c.pick,lead:c.lead,staticScore:c.staticScore,totalScore:null,ranking:result.ranking,evaluatedAt:new Date().toISOString()})}>この選出・先発にする</button>}<details><summary>役割・危険・相手6先発の説明</summary><CandidateDetail candidate={c} team={{...team,mons:battle.my}}/></details></article>)}
   <button class="btn" onClick={()=>setAll(!all)}>{all?'上位3候補に戻す':`全${result.candidates.length}候補を表示`}</button>
  </>}
  {legacy&&<details><summary>旧優先順位との比較（評価の正解ラベルではありません）</summary><p>{pickIndexes(legacy.pick,battle.my).map(i=>name({mons:battle.my},i)).join(' → ')}</p></details>}
 </section>;
}
