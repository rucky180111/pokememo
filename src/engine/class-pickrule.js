// class方式は旧pickruleと別保存。既存の条件式・名前解決だけを共用する。
import {dex,baseSpeciesId,megaFormeFor} from './dex.js';
import {parseCond,condMatches,teamSpecies} from './pickrule.js';
import {readTable} from './team-csv.js';
export const CLASS_HEADER='class,条件,役割ID,操作,候補,充足,強度,重要度,対応条件,前提役割ID,検証,役割種別,メモ';
export const CLASS_KINDS=['採用方針','対面処理','後出し','ストッパー','崩し','起点作り','その他'];
export const CLASS_EXAMPLE=CLASS_HEADER+'\n3,イエッサン,indeedee,採用,ゴリランダー;ドドゲザン,any,推奨,1,*,,未評価,対面処理,記入例。実際の型に対する対応可否を確認してから検証欄を変更\n3,アシレーヌ,primarina,採用,ゴリランダー,any,推奨,1,*,,未評価,対面処理,記入例。無条件の対策保証ではありません';
export const blankClassRules=()=>({schemaVersion:1,version:'1',updatedAt:new Date().toISOString(),rowsCsv:CLASS_HEADER,settings:{maxSelectedMegaHolders:1,axisBranches:null}});
const lex=(a,b)=>a<b?-1:a>b?1:0;
const listCmp=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]??-1)-(b[i]??-1);if(d)return d;}return 0;};
const combinations=(arr,n)=>n===0?[[]]:arr.flatMap((x,i)=>combinations(arr.slice(i+1),n-1).map(t=>[x,...t]));
const mega=m=>megaFormeFor(m.species,m.item);
export function compileClassRules(data,mons){
 const errors=[],rows=[],groups=new Map();
 const fail=(line,text)=>errors.push(`${line?`${line}行目`:'設定'}: ${text}`);
 if(data?.schemaVersion!==1)fail(0,'schemaVersionは1です');
 if(typeof data?.version!=='string'||!data.version.trim())fail(0,'ルールの版を入力してください');
 if(typeof data?.updatedAt!=='string'||!Number.isFinite(Date.parse(data.updatedAt)))fail(0,'更新日時が不正です');
 const settings=data?.settings;
 if(!settings||!Number.isInteger(settings.maxSelectedMegaHolders)||settings.maxSelectedMegaHolders<0||settings.maxSelectedMegaHolders>3)fail(0,'maxSelectedMegaHoldersは0〜3です');
 const resolve=(name,line)=>{
  const q=String(name||'').trim();
  const ids=mons.map((m,i)=>({m,i})).filter(({m})=>/^メガ/.test(q)||dex.species[q]?.mega ? q===mega(m)||q===dex.species[mega(m)]?.j : q===m.species || teamSpecies(q,[m])===m.species);
  if(ids.length!==1){fail(line,`候補「${q}」は自分の構築へ一意に解決できません`);return null;}return ids[0].i;
 };
 const condition=(text,line)=>{const c=parseCond(text);for(const e of c.errors)fail(line,e);if(/(^|\/)\s*\/+|\/\s*$/.test(String(text).replace(/／/g,'/')))fail(line,'空の条件があります');for(const alt of c.alts)for(const term of alt)if(term.min<1)fail(line,'頭数は1以上です');return c;};
 let table=[];try{table=readTable(String(data?.rowsCsv||''));}catch(e){fail(0,e.message);}
 const cols=table[0]?.cells.map(s=>s.trim())||[],header=CLASS_HEADER.split(',');
 if(cols.length!==header.length||new Set(cols).size!==cols.length||header.some(k=>!cols.includes(k)))fail(1,`見出しは ${CLASS_HEADER} です`);
 else for(const row of table.slice(1)){
  const line=row.line;if(row.cells.length!==cols.length){fail(line,'列数が見出しと異なります');continue;}
  const d=Object.fromEntries(cols.map((k,i)=>[k,row.cells[i].trim()]));
  if(!/^\d+$/.test(d.class)||Number(d.class)<1||!Number.isSafeInteger(Number(d.class)))fail(line,'classは1以上の整数です');
  if(!d['役割ID']||d['役割ID'].startsWith('__'))fail(line,'役割IDが空または予約語です');
  if(!['採用','除外','先発'].includes(d['操作']))fail(line,'操作は採用・除外・先発です');
  if(!['any','all'].includes(d['充足']))fail(line,'充足はanyまたはallです');
  if(d['操作']==='先発'&&d['充足']!=='any')fail(line,'先発は1匹なので充足はanyです');
  if(!['必須','推奨'].includes(d['強度']))fail(line,'強度は必須または推奨です');
  if(d['重要度']===''||!Number.isFinite(Number(d['重要度']))||Number(d['重要度'])<0)fail(line,'重要度は0以上の有限値です');
  if(!['確認済み','未評価'].includes(d['検証']))fail(line,'検証は確認済みまたは未評価です');
  if(!CLASS_KINDS.includes(d['役割種別']))fail(line,`役割種別は${CLASS_KINDS.join('・')}です`);
  const names=d['候補'].split(';').map(n=>n.trim());if(names.some(n=>!n))fail(line,'候補をセミコロンで区切って入力してください');
  const candidates=names.map(n=>resolve(n,line));if(new Set(candidates).size!==candidates.length)fail(line,'同じ候補が重複しています');
  const r={class:Number(d.class),id:d['役割ID'],condition:condition(d['条件'],line),conditionText:d['条件']||'*',action:d['操作'],candidates,mode:d['充足'],required:d['強度']==='必須',importance:Number(d['重要度']),eligibility:condition(d['対応条件'],line),eligibilityText:d['対応条件']||'*',depends:d['前提役割ID'],verified:d['検証']==='確認済み',kind:d['役割種別'],note:d['メモ'],line};
  const prior=groups.get(r.id);
  if(prior&&['class','action','mode','required','importance','kind'].some(k=>prior[k]!==r[k]))fail(line,`役割ID ${r.id} のclass・操作・充足・強度・重要度・種別を一致させてください`);
  if(!prior)groups.set(r.id,{...r,rows:[]});groups.get(r.id).rows.push(r);rows.push(r);
 }
 for(const r of rows)if(r.depends){const dep=groups.get(r.depends);if(!dep||dep.class>=r.class||dep.action!=='採用')fail(r.line,'前提役割IDは上位classの採用役割にしてください');}
 let axis=null;
 if(settings?.axisBranches!=null){
  const a=settings.axisBranches;
  if(!a||typeof a!=='object'||Array.isArray(a))fail(0,'axisBranchesはオブジェクトです');
  else{
   const char=resolve(a.charizard,0),gab=resolve(a.garchomp,0),g=groups.get(a.charizardRuleId);
   if(!g||g.class!==1||g.action!=='採用'||g.mode!=='any'||!g.required||g.kind!=='採用方針'||g.rows.length!==1||g.rows[0].candidates.length!==1||g.rows[0].candidates[0]!==char||!g.rows[0].verified||g.rows[0].depends||g.rows[0].condition.any||g.rows[0].eligibility.any===false)fail(0,'リザ軸はclass1・必須・確認済みの採用方針1行にし、既存の厳しい条件を入力してください（常時成立は不可）');
   if(a.class!==2)fail(0,'軸分岐のclassは2です');
   if(char===gab||char==null||gab==null||!mega(mons[char])||!mega(mons[gab]))fail(0,'軸分岐の2匹には異なるメガ石持ちを指定してください');
   axis={char,gab,ruleId:a.charizardRuleId,class:2};
  }
 }
 return {errors,rows,groups:[...groups.values()].sort((a,b)=>a.class-b.class||lex(a.id,b.id)),axis,settings,version:data?.version,updatedAt:data?.updatedAt};
}
export function compareClassCandidates(a,b){return listCmp(a.vector,b.vector)||listCmp(a.selected,b.selected)||a.lead-b.lead;}
export function evaluateClassRules(data,mons,opponents){
 const compiled=compileClassRules(data,mons);if(compiled.errors.length)return {...compiled,candidates:[],sets:[]};
 const errors=[],foes=opponents.map(o=>typeof o==='string'?o:o.species);
 if(mons.length!==6||mons.some(m=>!dex.species[m.species]||dex.species[m.species].mega)||new Set(mons.map(m=>baseSpeciesId(m.species))).size!==6)errors.push('自分の異なる6体をメガ前の姿で登録してください');
 if(foes.length!==6||foes.some(s=>!dex.species[s])||new Set(foes.map(baseSpeciesId)).size!==6)errors.push('相手の異なる6体を登録してください');
 if(errors.length)return {...compiled,errors,candidates:[],sets:[]};
 const groups=compiled.groups.map(g=>({...g,rows:g.rows.filter(r=>condMatches(r.condition,foes))})).filter(g=>g.rows.length);
 const axis=compiled.axis, charActive=axis&&groups.some(g=>g.id===axis.ruleId);
 const classes=[...new Set([...groups.map(g=>g.class),...(axis&&!charActive?[2]:[])])].sort((a,b)=>a-b),candidates=[],rejected=[],branchRejected=[];
 for(const selected of combinations(mons.map((_,i)=>i),3)){
  if(selected.filter(i=>mega(mons[i])).length>compiled.settings.maxSelectedMegaHolders)continue;
  let branch='通常';
  if(axis){
   if(charActive){if(!selected.includes(axis.char)||selected.includes(axis.gab)){branchRejected.push(selected);continue;}branch='リザ軸';}
   else {if(selected.includes(axis.char)){branchRejected.push(selected);continue;}if(selected.includes(axis.gab))branch='ガブ軸';else if(!selected.some(i=>mega(mons[i])))branch='メガなし';else {branchRejected.push(selected);continue;}}
  }
  for(const lead of selected){
   const details=[],byId=new Map();
   for(const g of groups){
    const available=g.rows.map(r=>({...r,eligible:condMatches(r.eligibility,foes)&&(!r.depends||byId.get(r.depends)?.satisfied)}));
    const registered=[...new Set(available.flatMap(r=>r.candidates))].sort((a,b)=>a-b);
    const verified=registered.filter(i=>available.some(r=>r.candidates.includes(i)&&r.verified&&r.eligible));
    const unknown=registered.filter(i=>!verified.includes(i)&&available.some(r=>r.candidates.includes(i)&&!r.verified));
    const pool=g.action==='先発'?[lead]:selected;
    let satisfied;
    if(g.action==='除外')satisfied=available.every(r=>r.verified&&r.eligible)&&(g.mode==='any'?!registered.some(i=>selected.includes(i)):!registered.every(i=>selected.includes(i)));
    else satisfied=g.mode==='any'?verified.some(i=>pool.includes(i)):registered.every(i=>verified.includes(i)&&pool.includes(i));
    const owners=g.action==='除外'?[]:verified.filter(i=>pool.includes(i));
    const reasons=available.map(r=>({condition:r.conditionText,eligibility:r.eligibilityText,depends:r.depends,verified:r.verified,eligible:!!r.eligible,note:r.note,candidates:r.candidates})).sort((a,b)=>lex(JSON.stringify(a),JSON.stringify(b)));
    const d={id:g.id,class:g.class,action:g.action,mode:g.mode,required:g.required,importance:g.importance,kind:g.kind,registered,verified,unknown,owners,satisfied,reasons};details.push(d);byId.set(g.id,d);
   }
   if(axis&&!charActive)details.push({id:'__axis_choice',class:2,action:'採用',mode:'any',required:true,importance:0,kind:'採用方針',registered:branch==='ガブ軸'?[axis.gab]:[],verified:branch==='ガブ軸'?[axis.gab]:[],unknown:[],owners:branch==='ガブ軸'?[axis.gab]:[],satisfied:true,reasons:[{condition:'class1リザ条件不成立',eligibility:'軸分岐',depends:'',verified:true,eligible:true,note:branch==='ガブ軸'?'ガブ軸の完成形を比較':'メガ石持ち0体の完成形を比較',candidates:branch==='ガブ軸'?[axis.gab]:[]}]});
   details.sort((a,b)=>a.class-b.class||lex(a.id,b.id));
   const violations=details.filter(g=>g.required&&!g.satisfied);
   if(violations.length){rejected.push({selected,lead,reasons:violations.map(g=>({id:g.id,class:g.class,unknown:!!g.unknown.length,action:g.action}))});continue;}
   const classResults=classes.map(cl=>{const rs=details.filter(g=>g.class===cl),missing=rs.filter(g=>!g.satisfied);return {class:cl,missingWeight:missing.reduce((n,g)=>n+g.importance,0),missingCount:missing.length,covered:rs.filter(g=>g.satisfied).map(g=>g.id),missing:missing.map(g=>g.id)};});
   const vector=classResults.flatMap(c=>[c.missingWeight,c.missingCount]);
   if(vector.some(v=>!Number.isFinite(v)))return {...compiled,errors:['重要度の合計が大きすぎます'],candidates:[],sets:[]};
   const concentration=selected.map(mon=>({mon,roles:details.filter(g=>g.action==='採用'&&g.kind!=='採用方針'&&g.satisfied&&(g.mode==='all'||g.owners.length===1)&&g.owners.includes(mon)).map(g=>g.id)})).filter(r=>r.roles.length>1);
   candidates.push({selected,lead,pick:[lead,...selected.filter(i=>i!==lead)],branch,details,classResults,vector,concentration,opening:'未評価',coverage:details.filter(g=>g.satisfied&&g.action==='採用'&&g.kind!=='採用方針').map(g=>g.id)});
  }
 }
 candidates.sort(compareClassCandidates);
 const setMap=new Map();for(const c of candidates){const key=c.selected.join();if(!setMap.has(key))setMap.set(key,{selected:c.selected,branch:c.branch,variants:[],best:c});setMap.get(key).variants.push(c);}
 const sets=[...setMap.values()].sort((a,b)=>compareClassCandidates(a.best,b.best));
 const reasons=[...new Set(rejected.flatMap(r=>r.reasons.map(g=>`class${g.class} ${g.id}（必須${g.action}${g.unknown?'・未評価':''}）`)))].sort(lex);
 return {...compiled,errors:[],candidates,sets,rejected,classes,activeCount:groups.length,charActive:!!charActive,noCandidates:!candidates.length?['条件を満たす選出なし',...reasons,...(axis?[`軸分岐：${charActive?'リザ採用・ガブ除外':'ガブ軸またはメガなし・リザ除外'}`]:[]),`メガ石持ちは最大${compiled.settings.maxSelectedMegaHolders}体`]:null,allSatisfied:candidates.some(c=>c.details.every(g=>g.satisfied)),unassessedOpponents:foes,branchExcludedCount:branchRejected.length};
}
export function classDecisionRecord(data,candidate){return {mode:'class',schemaVersion:1,version:data.version,updatedAt:data.updatedAt,recordedAt:new Date().toISOString(),...structuredClone(candidate)};}
