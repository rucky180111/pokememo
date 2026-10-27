// 選出評価・統合仕様v3。対戦AIを装わず、静的な全列挙と手動の検証ケースを扱う。
import {dex, baseSpeciesId, selectionSpeciesId, megaFormeFor} from './dex.js';
import {parseCond, condMatches, resolveAll, teamSpecies} from './pickrule.js';
import {readTable} from './team-csv.js';
export const ROLE_HEADER='条件,役割ID,候補,適性,重要度,合格点,不足減点,メモ';
export const RISK_HEADER='条件,自分条件,危険ID,対象,場面,減点,理由';
export const CASE_HEADER='相手条件,相手型ID,相手先発,自分先発,自分の初手,交代先,相手の初手仮説,初手後の状態,次ターンの見通し,評価,根拠';
export const CASE_STATES=['未評価','有利','引き先あり','条件付き','引き先なし','積みで崩れる'];
export const DEFAULT_RULES={schemaVersion:3,sampleOnly:false,teamSize:6,pickSize:3,registeredMegaHolderCount:2,minSelectedMegaHolders:0,maxSelectedMegaHolders:1,evaluateLeads:true,reserveOrderMatters:false,hardRules:[],riskRoleLinks:{},openingEvaluation:{requiredForFullRecommendation:true,depthFullTurns:3,leadWeightsSource:'manual_or_uniform_until_measured'},scoringWeights:{staticWeight:1,openingWeight:null,downsideWeight:null,status:'static_only_until_configured'}};
export const blankAssessment=()=>({schemaVersion:3,dataVersion:'1',updatedAt:new Date().toISOString(),source:'手動評価・未校正',rolesCsv:ROLE_HEADER,risksCsv:RISK_HEADER,openingCsv:CASE_HEADER,rules:structuredClone(DEFAULT_RULES)});
const lex=(a,b)=>a<b?-1:a>b?1:0;
const cmpList=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]??-1)-(b[i]??-1);if(d)return d;}return 0;};
export function plannedMega(mon){return megaFormeFor(mon.species,mon.item) || '';}
export function compileAssessment(data, team) {
 const errors=[], roles=[], risks=[], cases=[], hardRules=[];
 const fail=(file,line,msg)=>errors.push(`${file}${line ? ` ${line}行目` : ''}: ${msg}`);
 const mons=team?.mons || [];
 const own=(name,file,line)=>{
  const q=String(name || '').trim();
  let found=mons.map((m,i)=>({m,i})).filter(({m})=>q===m.species || q===plannedMega(m));
  if(!found.length)found=mons.map((m,i)=>({m,i})).filter(({m})=>/^メガ/.test(q) || dex.species[q]?.mega ? q===dex.species[plannedMega(m)]?.j || q===plannedMega(m) : teamSpecies(q,[m])===m.species);
  if(found.length!==1){fail(file,line,`「${q}」は自分の構築へ一意に解決できません`);return null;}return found[0].i;
 };
 const species=(name,file,line)=>{const ids=dex.species[name] ? [name] : resolveAll(name);if(!ids.length)fail(file,line,`ポケモン「${name}」が見つかりません`);return ids;};
 const cond=(text,file,line)=>{const c=parseCond(text);if(/(^|\/)\s*\/+|\/\s*$/.test(text))c.errors.push('空の条件があります');for(const e of c.errors)fail(file,line,e);for(const a of c.alts)for(const t of a)if(t.min<1)fail(file,line,'頭数は1以上です');return c;};
 const num=(v,file,line,name,max=Infinity)=>{if(v==='' || v==null || !Number.isFinite(Number(v)) || Number(v)<0 || Number(v)>max){fail(file,line,`${name}は0〜${max===Infinity?'有限の数値':max}です`);return 0;}return Number(v);};
 const table=(text,header,file,visit,optional=[])=>{
  let rows;try{rows=readTable(String(text || header));}catch(e){fail(file,0,e.message);return;}
  if(!rows.length){fail(file,1,'見出しが必要です');return;}
  const cols=rows[0].cells.map(s=>s.trim()),need=header.split(',');
  if(new Set(cols).size!==cols.length || need.some(k=>!cols.includes(k)) || cols.some(k=>!need.includes(k)&&!optional.includes(k))){fail(file,rows[0].line,`見出しは「${header}」を使用してください`);return;}
  for(const r of rows.slice(1)){if(r.cells.length!==cols.length){fail(file,r.line,'列数が見出しと異なります');continue;}visit(Object.fromEntries(cols.map((k,i)=>[k,r.cells[i].trim()])),r.line);}
 };
 let rules=data?.rules;
 if(!rules || typeof rules!=='object' || Array.isArray(rules)){fail('rules.json',0,'JSONオブジェクトが必要です');rules={};}
 if(data?.schemaVersion!==3 || rules.schemaVersion!==3)fail('rules.json',0,'schemaVersionは3です');
 for(const [k,v] of [['teamSize',6],['pickSize',3],['evaluateLeads',true],['reserveOrderMatters',false]])if(rules[k]!==v)fail('rules.json',0,`${k}は${v}にしてください`);
 for(const k of ['minSelectedMegaHolders','maxSelectedMegaHolders','registeredMegaHolderCount'])if(!Number.isInteger(rules[k]) || rules[k]<0 || rules[k]>6)fail('rules.json',0,`${k}は0〜6の整数です`);
 if(rules.minSelectedMegaHolders>rules.maxSelectedMegaHolders || rules.maxSelectedMegaHolders>3)fail('rules.json',0,'メガ石持ちの選出数の上下限が不正です');
 if(!Array.isArray(rules.hardRules))fail('rules.json',0,'hardRulesは配列です');
 if(rules.tieBreak!==undefined && JSON.stringify(rules.tieBreak)!==JSON.stringify(['scoreDescending','uncoveredSeverityAscending','leadRiskAscending','originalTeamOrderAscending']))fail('rules.json',0,'tieBreakは仕様v3の得点・不足重要度・先発危険・登録順です');
 if(!rules.riskRoleLinks || typeof rules.riskRoleLinks!=='object' || Array.isArray(rules.riskRoleLinks))fail('rules.json',0,'riskRoleLinksは役割IDの対応表です');
 if(typeof data?.dataVersion!=='string' || !data.dataVersion.trim() || typeof data?.source!=='string' || !data.source.trim() || typeof data?.updatedAt!=='string' || !Number.isFinite(Date.parse(data.updatedAt)))fail('評価データ',0,'版番号・更新日時・根拠を入力してください');
 if(typeof rules.sampleOnly!=='boolean')fail('rules.json',0,'sampleOnlyはtrue/falseです');
 if(!rules.openingEvaluation || typeof rules.openingEvaluation!=='object' || Array.isArray(rules.openingEvaluation))fail('rules.json',0,'openingEvaluationは設定オブジェクトです');
 const weights=rules.scoringWeights;
 if(!weights || !Number.isFinite(weights.staticWeight) || weights.staticWeight<0)fail('rules.json',0,'staticWeightは0以上の有限値です');
 for(const k of ['openingWeight','downsideWeight'])if(weights?.[k]!=null && (!Number.isFinite(weights[k])||weights[k]<0))fail('rules.json',0,`${k}は未設定(null)または0以上の有限値です`);
 const groups=new Map();
 table(data?.rolesCsv,ROLE_HEADER,'roles.csv',(d,line)=>{
  if(!d['役割ID'])fail('roles.csv',line,'役割IDが空です');
  const row={id:d['役割ID'],condition:cond(d['条件'],'roles.csv',line),mon:own(d['候補'],'roles.csv',line),fit:num(d['適性'],'roles.csv',line,'適性',100),weight:num(d['重要度'],'roles.csv',line,'重要度'),threshold:num(d['合格点'],'roles.csv',line,'合格点',100),penalty:num(d['不足減点'],'roles.csv',line,'不足減点'),note:d['メモ'],line};
  const prior=groups.get(row.id);if(prior && ['weight','threshold','penalty'].some(k=>prior[k]!==row[k]))fail('roles.csv',line,`役割ID ${row.id} の重要度・合格点・不足減点が一致しません`);groups.set(row.id,row);roles.push(row);
 });
 table(data?.risksCsv,RISK_HEADER,'risks.csv',(d,line)=>{
  const scene=d['場面'],id=d['危険ID'];if(!id)fail('risks.csv',line,'危険IDが空です');if(!['選出','先発','対応'].includes(scene))fail('risks.csv',line,'場面は選出・先発・対応です');
  const link=rules.riskRoleLinks?.[id],links=Array.isArray(link)?link:[link];
  if(scene==='対応' && (!link || !links.length || links.some(x=>!groups.has(x))))fail('risks.csv',line,`対応リスク ${id} のriskRoleLinksに既存の役割IDが必要です`);
  risks.push({id,condition:cond(d['条件'],'risks.csv',line),selfCondition:cond(d['自分条件'],'risks.csv',line),mon:own(d['対象'],'risks.csv',line),scene,penalty:num(d['減点'],'risks.csv',line,'減点'),reason:d['理由'],links,line});
 });
 for(const [i,h] of (Array.isArray(rules.hardRules)?rules.hardRules:[]).entries()){
  if(!h || !['forbid','require_any'].includes(h.type)){fail('rules.json',i+1,'hardRulesのtypeはforbidまたはrequire_anyです');continue;}
  const targets=h.type==='forbid'?[h.target]:h.targets;
  if(!Array.isArray(targets)||!targets.length){fail('rules.json',i+1,'対象が必要です');continue;}
  hardRules.push({condition:cond(h.condition || '*','rules.json',i+1),type:h.type,targets:targets.map(n=>own(n,'rules.json',i+1)),label:`${h.condition || '*'}: ${h.type} ${targets.join('・')}`});
 }
 table(data?.openingCsv,CASE_HEADER,'opening-cases.csv',(d,line)=>{
  const state=d['評価'];if(!CASE_STATES.includes(state))fail('opening-cases.csv',line,`評価は${CASE_STATES.join('・')}です`);
  const verified=d['検証済み']==='true';if(d['検証済み'] && !['true','false'].includes(d['検証済み']))fail('opening-cases.csv',line,'検証済みはtrue/falseです');
  if(state!=='未評価' && (!verified || !d['根拠']))fail('opening-cases.csv',line,'評価済みケースには検証済み=trueと根拠が必要です');
  if(!d['相手型ID']||!d['自分の初手']||!d['相手の初手仮説'])fail('opening-cases.csv',line,'型ID・自分の初手・相手の初手仮説を入力してください');
  cases.push({condition:cond(d['相手条件'],'opening-cases.csv',line),selfCondition:cond(d['自分条件'] || '*','opening-cases.csv',line),foe:species(d['相手先発'],'opening-cases.csv',line),lead:own(d['自分先発'],'opening-cases.csv',line),to:d['交代先']?own(d['交代先'],'opening-cases.csv',line):null,hypothesis:d['相手型ID'],action:d['自分の初手'],opponentAction:d['相手の初手仮説'],after:d['初手後の状態'],next:d['次ターンの見通し'],state,reason:d['根拠'],verified,line});
 },['検証済み','自分条件']);
 const leadWeights=rules.openingEvaluation?.leadWeights;
 if(leadWeights!==undefined){
  if(!leadWeights || typeof leadWeights!=='object' || Array.isArray(leadWeights))fail('rules.json',0,'leadWeightsは種族名/IDと重みの対応表です');
  else {for(const [name,v]of Object.entries(leadWeights)){species(name,'rules.json',0);if(typeof v!=='number')fail('rules.json',0,'先発重みは数値です');num(v,'rules.json',0,'先発重み');}if(!Object.values(leadWeights).some(v=>Number(v)>0))fail('rules.json',0,'先発重みを全て0にはできません');}
  if(!['manual','measured'].includes(rules.openingEvaluation?.leadWeightsSource))fail('rules.json',0,'先発重みの出所はmanualまたはmeasuredです');
 }
 return {errors,roles,risks,cases,hardRules,rules,metadata:{version:data?.dataVersion,updatedAt:data?.updatedAt,source:data?.source,sampleOnly:!!rules.sampleOnly}};
}
function combinations(arr,n){if(!n)return [[]];return arr.flatMap((x,i)=>combinations(arr.slice(i+1),n-1).map(t=>[x,...t]));}
export function evaluateSelection(data,team,opponents){
 const compiled=compileAssessment(data,team);if(compiled.errors.length)return {...compiled,candidates:[]};
 const {roles,risks,cases,hardRules,rules}=compiled,mons=team.mons;
 const errors=[];if(mons.some(m=>dex.species[m.species]?.mega))errors.push('自分の構築はメガ前の種族と持ち物を登録してください');if(mons.length!==6 || mons.some(m=>!dex.species[m.species]))errors.push('自分の6体を登録してください');
 if(new Set(mons.map(m=>baseSpeciesId(m.species))).size!==mons.length)errors.push('自分の構築に同種族が重複しています');
 const foeIds=opponents.map(o=>typeof o==='string'?o:o.species);
 if(foeIds.length!==6 || foeIds.some(id=>!dex.species[id]) || new Set(foeIds.map(baseSpeciesId)).size!==6)errors.push('相手の異なる6体を登録してください');
 const holders=mons.map(m=>!!plannedMega(m));if(holders.filter(Boolean).length!==rules.registeredMegaHolderCount)errors.push(`構築のメガ石持ちは${rules.registeredMegaHolderCount}体の設定です（実際は${holders.filter(Boolean).length}体）`);
 if(errors.length)return {...compiled,errors,candidates:[]};
 let leadWeights=foeIds.map(()=>1);const supplied=rules.openingEvaluation?.leadWeights;
 if(supplied){leadWeights=foeIds.map(id=>Object.entries(supplied).filter(([name])=>name===id || resolveAll(name).includes(baseSpeciesId(id))).reduce((sum,[,v])=>sum+v,0));if(!leadWeights.some(x=>x>0))return {...compiled,errors:['相手6体の先発重みが全て0です'],candidates:[]};}
 const maxWeight=Math.max(...leadWeights);leadWeights=leadWeights.map(v=>v/maxWeight);const sum=leadWeights.reduce((a,v)=>a+v,0);leadWeights=leadWeights.map(v=>v/sum);
 const liveRoles=roles.filter(r=>condMatches(r.condition,foeIds));const groups=[...new Set(liveRoles.map(r=>r.id))].sort(lex).map(id=>({id,rows:liveRoles.filter(r=>r.id===id)}));
 const liveHard=hardRules.filter(h=>condMatches(h.condition,foeIds)),rejected=[],candidates=[];let sets=0;
 for(const selected of combinations(mons.map((_,i)=>i),3)){
  const h=selected.filter(i=>holders[i]).length;if(h<rules.minSelectedMegaHolders || h>rules.maxSelectedMegaHolders)continue;
  const violations=liveHard.filter(r=>r.type==='forbid'?r.targets.some(i=>selected.includes(i)):!r.targets.some(i=>selected.includes(i)));
  if(violations.length){rejected.push({selected,reasons:violations.map(r=>r.label)});continue;}sets++;
  const ownIds=selected.map(i=>mons[i].species),active=risks.filter(r=>condMatches(r.condition,foeIds)&&condMatches(r.selfCondition,ownIds));
  const dedup=new Map();for(const rawRisk of active){const {line,...r}=rawRisk;const key=JSON.stringify([r.id,r.mon,r.scene]);const prev=dedup.get(key);if(!prev || r.penalty>prev.penalty)dedup.set(key,{...r,reasons:[r.reason]});else if(r.penalty===prev.penalty)prev.reasons.push(r.reason);}
  const rr=[...dedup.values()].map(r=>{const reasons=[...new Set(r.reasons)].sort(lex);return {...r,reason:reasons[0],reasons};}).sort((a,b)=>lex(JSON.stringify([a.id,a.mon,a.scene]),JSON.stringify([b.id,b.mon,b.scene])));
  const roleDetails=groups.map(({id,rows})=>{
   const meta=rows[0],alternatives=mons.map((_,mon)=>{const rs=rows.filter(r=>r.mon===mon);if(!rs.length)return null;
    const fit=Math.max(...rs.map(r=>r.fit)),effects=rr.filter(r=>r.scene==='対応'&&r.mon===mon&&r.links.includes(id));
    return {mon,fit,adjusted:Math.max(0,fit-effects.reduce((s,r)=>s+r.penalty,0)),effects,notes:[...new Set(rs.map(r=>r.note))].sort(lex),selected:selected.includes(mon)};
   }).filter(Boolean).sort((a,b)=>b.adjusted-a.adjusted||a.mon-b.mon);
   const available=alternatives.filter(r=>r.selected),fit=available[0]?.adjusted ?? 0,short=fit<meta.threshold;
   return {id,weight:meta.weight,threshold:meta.threshold,penalty:short?meta.penalty:0,fit,short,points:meta.weight*(fit/100),owner:fit>0?available[0].mon:null,alternatives,sole:available.filter(a=>a.adjusted>=meta.threshold && a.adjusted>0).length===1};
  });
  const concentration=selected.map(mon=>({mon,roles:roleDetails.filter(g=>g.sole&&g.owner===mon&&!g.short).map(g=>g.id)})).filter(x=>x.roles.length>1);
  const rolePoints=roleDetails.reduce((s,g)=>s+g.points,0),shortfall=roleDetails.reduce((s,g)=>s+g.penalty,0),uncoveredSeverity=roleDetails.filter(g=>g.short).reduce((s,g)=>s+g.weight,0);
  const pickRisks=rr.filter(r=>r.scene==='選出'&&selected.includes(r.mon)),pickRisk=pickRisks.reduce((s,r)=>s+r.penalty,0);
  for(const lead of selected){
   const leadRisks=rr.filter(r=>r.scene==='先発'&&r.mon===lead),leadRisk=leadRisks.reduce((s,r)=>s+r.penalty,0),staticScore=rolePoints-shortfall-pickRisk-leadRisk;
   const opening=foeIds.map((foe,i)=>({foe,probability:leadWeights[i],state:'未評価',coverage:'ケース参照・全分岐の網羅性は未確認',cases:cases.filter(c=>c.lead===lead&&(c.foe.includes(foe)||c.foe.includes(selectionSpeciesId(foe)))&&condMatches(c.condition,foeIds)&&condMatches(c.selfCondition,ownIds)&&(c.to==null||selected.includes(c.to)&&c.to!==lead)).sort((a,b)=>lex(JSON.stringify([a.hypothesis,a.action,a.opponentAction,a.after,a.next,a.state,a.reason]),JSON.stringify([b.hypothesis,b.action,b.opponentAction,b.after,b.next,b.state,b.reason])))}));
   candidates.push({selected,lead,pick:[lead,...selected.filter(i=>i!==lead)],mega:selected.filter(i=>holders[i]).map(i=>({mon:i,forme:plannedMega(mons[i])})),staticScore,totalScore:null,rolePoints,shortfall,pickRisk,leadRisk,pickRisks,leadRisks,roles:roleDetails,concentration,uncoveredSeverity,opening});
  }
 }
 if(candidates.some(c=>![c.staticScore,c.rolePoints,c.shortfall,c.pickRisk,c.leadRisk,c.uncoveredSeverity].every(Number.isFinite)))return {...compiled,errors:['合計点が数値の上限を超えています。重みや減点を小さくしてください'],candidates:[]};
 candidates.sort((a,b)=>b.staticScore-a.staticScore||a.uncoveredSeverity-b.uncoveredSeverity||a.leadRisk-b.leadRisk||cmpList(a.pick,b.pick));
 return {...compiled,errors:[],candidates,rejected,sets,activeRoleCount:groups.length,leadWeightsSource:supplied ? rules.openingEvaluation.leadWeightsSource : 'uniform_assumption',gap:candidates.length>1?candidates[0].staticScore-candidates[1].staticScore:null,ranking:'static_only',openingStatus:cases.some(c=>c.verified)?'manual_cases_partial':'unevaluated',totalUnavailable:'初動Q・下振れリスクの数値モデルと係数が揃うまで総合点は未評価。静的順位で比較しています。',noCandidates:candidates.length?null:['条件を満たす選出なし',`メガ石持ちの選出数：${rules.minSelectedMegaHolders}〜${rules.maxSelectedMegaHolders}体`,...new Set(rejected.flatMap(x=>x.reasons))]};
}
