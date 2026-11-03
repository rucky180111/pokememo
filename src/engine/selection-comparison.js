import {decidePick,pickIndexes} from './pickrule.js';
export const SELECTION_MODES=[['legacy','優先順位'],['class','class・代替候補'],['assessment','役割・危険評価']];
export function comparisonData(battle,team){
 return {legacy:battle.pickRules??team?.pickRules,class:battle.classPickRules??team?.classPickRules,assessment:battle.selectionAssessment??team?.selectionAssessment};
}
export function selectionStarted(b){return !!b.turns?.length||['me','opp'].some(s=>b.state?.sides?.[s]?.active?.some(i=>i!=null));}
// タブの閲覧では呼ばない。選出案を明示適用した場合だけ方式・根拠を保存する。
export function applySelectionComparison(b,mode,pick,data,record){
 if(selectionStarted(b)||!SELECTION_MODES.some(([m])=>m===mode)||!data||!Array.isArray(pick)||!pick.length||pick.some(i=>!Number.isInteger(i)||i<0||i>=b.my.length)||new Set(pick).size!==pick.length||pick.length>(b.format==='double'?4:3))return false;
 if(mode!=='legacy'&&(b.format==='double'||pick.length!==3))return false;
 const copy=x=>JSON.parse(JSON.stringify(x));
 let reason;
 if(mode==='legacy'){
  if(!Array.isArray(data)||!data.length)return false;
  const hit=decidePick(data,b.opp.map(o=>o.species),b.my.map(m=>m.species));
  if(!hit)return false;
  const expected=pickIndexes(hit.pick,b.my).slice(0,b.format==='double'?4:3);
  if(pick.length!==expected.length||pick.some((mon,i)=>mon!==expected[i]))return false;
  b.pickRules=copy(data);
  reason={mode,format:'priority-csv',pick:pick.slice(),lead:pick[0],matchedRows:hit.rows,from:hit.from,bans:hit.bans,auto:hit.auto};
 }else{
  if(!record || (mode==='class'?record.version!==data.version:record.dataVersion!==data.dataVersion) || record.updatedAt!==data.updatedAt)return false;
  reason={...copy(record),mode,pick:pick.slice(),lead:pick[0]};
  if(mode==='class'){b.classPickRules=copy(data);b.classPickDecision=copy(reason);}
  else {b.selectionAssessment=copy(data);b.selectionRecommendation=copy(reason);}
 }
 b.pick.me=pick.slice();b.pickRuleMode=mode;
 b.selectionDecision={...reason,mode,pick:pick.slice(),lead:pick[0],appliedAt:new Date().toISOString()};
 return true;
}
