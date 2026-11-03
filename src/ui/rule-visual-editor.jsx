import {useMemo,useState} from 'preact/hooks';
import {dex,speciesName,selectionSpeciesId} from '../engine/dex.js';
import {readTable} from '../engine/team-csv.js';
import {teamSpecies,resolveSpecies} from '../engine/pickrule.js';
import {Sheet,Sprite,cx} from './common.jsx';
import {CondIcons} from './condition-icons.jsx';
const csvCell=v=>/[",\n\r]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v);
export const encodeRuleTable=rows=>rows.map(r=>r.map(csvCell).join(',')).join('\n');
export function CandidateIcons({names,mons,mode='any',action=''}){
 const parts=String(names||'').split(';').filter(Boolean);
 return <span class={cx('rule-candidates',action==='除外'&&'excluded')}>{parts.length?parts.map((n,i)=>{
  const sid=teamSpecies(n,mons)|| (dex.species[n]?n:resolveSpecies(n));
  return <>{i>0&&<b class="rule-join">{mode==='all'?'＋':'または'}</b>}<span class="rule-mon">{sid&&<Sprite id={selectionSpeciesId(sid)} size={32}/>}<span>{n}</span>{action==='除外'&&<b>×</b>}{action==='先発'&&<small>先発</small>}</span></>;
 }):<span class="muted">未設定</span>}</span>;
}
const field=(key,type='text',options)=>({key,type,options});
export const CLASS_FIELDS=[field('class','number'),field('条件','condition'),field('役割ID'),field('操作','select',['採用','除外','先発']),field('候補','mons'),field('充足','select',['any','all']),field('強度','select',['必須','推奨']),field('重要度','number'),field('対応条件','condition'),field('前提役割ID'),field('検証','select',['未評価','確認済み']),field('役割種別','select',['採用方針','対面処理','後出し','ストッパー','崩し','起点作り','その他']),field('メモ','note')];
export const ROLE_FIELDS=[field('条件','condition'),field('役割ID'),field('候補','mon'),...['適性','重要度','合格点','不足減点'].map(k=>field(k,'number')),field('メモ','note')];
export const RISK_FIELDS=[field('条件','condition'),field('自分条件','condition'),field('危険ID'),field('対象','mon'),field('場面','select',['選出','先発','対応']),field('減点','number'),field('理由','note')];
export const CASE_FIELDS=[field('相手条件','condition'),field('相手型ID'),field('相手先発'),field('自分先発','mon'),field('自分の初手'),field('交代先','mon'),field('相手の初手仮説'),field('初手後の状態','note'),field('次ターンの見通し','note'),field('評価','select',['未評価','有利','引き先あり','条件付き','引き先なし','積みで崩れる']),field('根拠','note'),field('検証済み','select',['false','true']),field('自分条件','condition')];
function Diagram({d,kind,mons}){
 const cond=d['条件']||d['相手条件']||'*';
 return <div class="rule-diagram">
  <div class="rule-if"><CondIcons cond={cond} preview anyLabel="いつでも"/><small>{cond==='*'?'いつでも':cond}</small></div><b class="rule-arrow" aria-hidden="true">⇒</b>
  <div class="rule-then">
   {kind==='class'&&<><span class="tag">class {d.class||'未設定'}</span><b>{d['操作']||'未設定'}</b><CandidateIcons names={d['候補']} mons={mons} mode={d['充足']} action={d['操作']}/><div class="rule-tags"><span>{d['操作']==='除外'?(d['充足']==='all'?'同時選出を避ける':'各候補を除外'):d['充足']==='all'?'全員必要':'いずれか1匹'}</span><span>{d['強度']}</span><span>{d['役割種別']}</span><span class={d['検証']==='未評価'?'rule-unknown':''}>{d['検証']}</span></div><small>{d['役割ID']}{d['前提役割ID']&&` ／ 前提：${d['前提役割ID']}`}</small>{d['対応条件']&&d['対応条件']!=='*'&&<div>対応条件：<CondIcons cond={d['対応条件']} preview/></div>}</>}
   {kind==='role'&&<><CandidateIcons names={d['候補']} mons={mons}/><div class="rule-tags"><b>適性 {d['適性']||'未設定'}</b><span>重要度 {d['重要度']}</span><span>合格点 {d['合格点']}</span><span>不足 −{d['不足減点']}</span></div><small>{d['役割ID']}</small></>}
   {kind==='risk'&&<><CandidateIcons names={d['対象']} mons={mons}/><div class="rule-tags"><b>{d['場面']} −{d['減点']}</b><span>{d['危険ID']}</span></div>{d['自分条件']&&<div>選出条件：<CondIcons cond={d['自分条件']} preview/></div>}</>}
   {kind==='case'&&<><CandidateIcons names={d['自分先発']} mons={mons} action="先発"/><span>対</span><CandidateIcons names={d['相手先発']} mons={[]}/><b>{d['自分の初手']}</b>{d['交代先']&&<CandidateIcons names={d['交代先']} mons={mons}/>}<small>相手：{d['相手の初手仮説']} ／ {d['相手型ID']}</small>{d['初手後の状態']&&<small>行動後：{d['初手後の状態']}</small>}{d['次ターンの見通し']&&<small>次ターン：{d['次ターンの見通し']}</small>}<span class={d['評価']==='未評価'?'rule-unknown':''}>{d['検証済み']==='true'?d['評価']:'未評価・検証前'}</span></>}
   {(d['メモ']||d['理由']||d['根拠'])&&<small>{d['メモ']||d['理由']||d['根拠']}</small>}
  </div>
 </div>;
}
export function RuleVisualEditor({text,header,fields,mons,kind,title,csvLabel=`${title}CSV`,onChange}){
 const [editing,setEditing]=useState(null),[bulk,setBulk]=useState(null),[error,setError]=useState('');
 const table=useMemo(()=>{try{const rows=readTable(text||header);if(!rows.length||header.split(',').some(k=>!rows[0].cells.map(s=>s.trim()).includes(k)))return {error:'見出しを確認してください。まとめて入力から修正できます。'};return {cols:rows[0].cells.map(s=>s.trim()),rows:rows.slice(1)};}catch(e){return {error:e.message};}},[text,header]);
 const shownRows=(table.rows||[]).map((r,i)=>({r,i}));if(kind==='class')shownRows.sort((a,b)=>Number(a.r.cells[table.cols.indexOf('class')])-Number(b.r.cells[table.cols.indexOf('class')])||a.i-b.i);
 const write=(cols,rows)=>onChange(encodeRuleTable([cols,...rows]));
 const open=(index)=>{const base=table.cols||header.split(',');const cols=[...base,...fields.map(f=>f.key).filter(k=>!base.includes(k))];setEditing({index,cols,values:index==null?Object.fromEntries(cols.map(k=>[k,k==='検証'?'未評価':k==='評価'?'未評価':''])):Object.fromEntries(cols.map((k,i)=>[k,table.rows[index].cells[table.cols.indexOf(k)]||'']))});};
 const update=(k,v)=>setEditing(e=>({...e,values:{...e.values,[k]:v}}));
 return <section class="rule-visual-editor" aria-label={`${title}の図解一覧`}>
  <div class="btnrow"><button class="btn" onClick={()=>open(null)} disabled={!!table.error}>＋ 条件を追加</button><button class="btn" onClick={()=>{setBulk(text||header);setError('');}}>まとめて入力・書き出し</button></div>
  {table.error?<p role="alert">{table.error}</p>:!table.rows.length?<p class="hint">条件を追加するか、CSVをまとめて入力してください。</p>:<ol class="rule-visual-list">{shownRows.map(({r,i})=><li><button class="rule-visual-row" aria-label={`${title}${i+1}を編集`} onClick={()=>open(i)}><Diagram d={Object.fromEntries(table.cols.map((k,j)=>[k,r.cells[j]||'']))} kind={kind} mons={mons}/><span class="rule-edit-label">編集 ›</span></button></li>)}</ol>}
  {editing&&<Sheet title={`${title}を編集`} onClose={()=>setEditing(null)}><div class="pad rule-row-form">{editing.cols.map(k=>{
   const f=fields.find(f=>f.key===k)||field(k),value=editing.values[k]||'';
   return <div class="field"><label><span>{k}</span>{f.type==='select'?<select class="input" aria-label={k} value={value} onChange={e=>update(k,e.currentTarget.value)}><option value="">選択</option>{f.options.map(o=><option value={o}>{o==='any'?(editing.values['操作']==='除外'?'各候補を除外（any）':'いずれか1匹（any）'):o==='all'?(editing.values['操作']==='除外'?'同時選出禁止（all）':'全員（all）'):o}</option>)}</select>:['mon','mons'].includes(f.type)?null:f.type==='note'?<textarea class="input" aria-label={k} value={value} onInput={e=>update(k,e.currentTarget.value)}/>:<input class="input" aria-label={k} type={f.type==='number'?'number':'text'} min={k==='class'?1:0} step={k==='class'?1:'any'} value={value} onInput={e=>update(k,e.currentTarget.value)}/>}</label>
    {['mon','mons'].includes(f.type)&&<div class="rule-mon-picker" role="group" aria-label={k}>{mons.map(m=>{const selected=value.split(';').some(n=>teamSpecies(n,mons)===m.species);return <button class={cx('btn',selected&&'primary')} aria-pressed={selected} onClick={()=>{const rest=value.split(';').filter(n=>n&&teamSpecies(n,mons)!==m.species);update(k,selected?(f.type==='mon'?'':rest.join(';')):f.type==='mon'?speciesName(m.species):[...rest,speciesName(m.species)].join(';'));}}><Sprite id={selectionSpeciesId(m.species)} size={32}/>{speciesName(m.species)}</button>;})}{value&&<button class="btn" onClick={()=>update(k,'')}>空欄にする</button>}</div>}
    {f.type==='condition'&&<CondIcons cond={value||'*'} preview anyLabel={k==='条件'||k==='相手条件'?'いつでも':'追加条件なし'}/>}
   </div>;
  })}<p class="hint">行の変更は編集欄へ反映されます。最後に保存ボタンで確定してください。</p><div class="btnrow">{editing.index!=null&&<button class="btn danger" onClick={()=>{write(editing.cols,table.rows.filter((_,i)=>i!==editing.index).map(r=>editing.cols.map(k=>r.cells[table.cols.indexOf(k)]||'')));setEditing(null);}}>この行を削除</button>}<button class="btn primary" onClick={()=>{const rows=table.rows.map(r=>editing.cols.map(k=>r.cells[table.cols.indexOf(k)]||'')),row=editing.cols.map(k=>editing.values[k]||'');if(editing.index==null)rows.push(row);else rows[editing.index]=row;write(editing.cols,rows);setEditing(null);}}>この行を反映</button></div></div></Sheet>}
  {bulk!=null&&<Sheet title={`${title}をまとめて入力`} onClose={()=>setBulk(null)}><div class="pad"><p class="hint">見出し付きCSVを貼り付けて反映します。保存前に図解と検証結果を確認できます。</p><label class="field"><span>{csvLabel}</span><textarea class="input assessment-source" rows={14} value={bulk} onInput={e=>setBulk(e.currentTarget.value)} spellcheck={false}/></label>{error&&<p role="alert">{error}</p>}<div class="btnrow"><button class="btn" onClick={()=>{const u=URL.createObjectURL(new Blob(['\uFEFF'+bulk],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=`pokememo-${kind}-rules.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}}>CSVを書き出す</button><button class="btn" onClick={()=>setBulk(null)}>取消</button><button class="btn primary" onClick={()=>{try{const rows=readTable(bulk);if(!rows.length||header.split(',').some(k=>!rows[0].cells.map(s=>s.trim()).includes(k)))throw new Error('見出しが異なります');onChange(bulk);setBulk(null);}catch(e){setError(e.message);}}}>この内容を反映</button></div></div></Sheet>}
 </section>;
}
