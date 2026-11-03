import {useRef,useState} from 'preact/hooks';
import {speciesName,itemName,abilityName,natureName,moveName} from '../engine/dex.js';
import {rulesToText,RULES_HEADER} from '../engine/pickrule.js';
import {CLASS_HEADER,blankClassRules} from '../engine/class-pickrule.js';
import {ROLE_HEADER,RISK_HEADER,CASE_HEADER,blankAssessment} from '../engine/selection-assessment.js';
import {useApp} from './common.jsx';
export function pickrulePrompt(team,mode){
 const mons=team.mons.map(m=>({ポケモン:speciesName(m.species),持ち物:itemName(m.item)||'なし',特性:abilityName(m.ability),性格:natureName(m.nature),能力Pt:m.sp,技:(m.moves||[]).map(id=>({名前:moveName(id),ID:id}))}));
 const common='ポケメモへ読み込む選出条件を作成してください。条件・評価は私の指定と提供データだけを使い、不明点は先に質問してください。構築にいない候補や架空の適性点・勝率を作らないでください。未検証の役割や初動は未評価にし、対戦シミュレーション済みと表現しないでください。\n条件式：+ はかつ、| は候補のまたは、- は不在、/ は条件全体のまたは、N体以上: と「〇〇タイプ」が使えます。A+-Bなど空の名前を作らないでください。* は常時成立です。\n';
 const instructions={
  legacy:`方式：優先順位。上から一致した行を重ねて3体を決め、左端が先発です。候補に -名前 を書くと除外指定です。\n返答形式：見出し「${RULES_HEADER}」から始まるCSVのみ。条件に対する3体を指定し、CSVセル内の引用符・改行など複雑な書式は使わないでください。\n現在の保存済みCSV：\n${rulesToText(team.pickRules||[])}`,
  class:`方式：class・代替候補。小さいclassを優先し、同classの行順で結果を変えません。候補はセミコロン区切り（ゴリランダー;ドドゲザン）。any=どちらか1匹、all=両方必要。操作は採用/除外/先発、強度は必須/推奨です。採用だけで先発を指定しないでください。除外anyは各候補の除外、除外allは同時選出禁止、先発はanyです。\nCSV見出し：${CLASS_HEADER}\n同じ役割IDはclass・操作・充足・強度・重要度・役割種別を一致させてください。対応条件は候補が担当できる追加条件、前提役割IDは上位classの採用役割だけを参照します。検証は確認済み/未評価。役割種別は採用方針/対面処理/後出し/ストッパー/崩し/起点作り/その他。対面処理と後出しを混同しないでください。重要度が未指定なら質問してください。\nリザの採用条件は私が指定する厳しい条件をそのまま使い、緩めないでください。axisBranchesを使う場合はclass1の必須・確認済み採用方針1行を参照し、候補はリザ1匹、対応条件は*、常時成立条件は禁止。axisBranches={charizardRuleId:参照ID,charizard:自軍の名前,garchomp:自軍の名前,class:2}。両者が石持ちの時だけ使います。成立時はリザ採用・ガブ除外、不成立時はガブ軸/メガなしを比較します。メガなしを候補名に書かないでください。\n返答形式：次の形式のJSONオブジェクトのみ。rowsCsvに見出し付きCSV文字列、versionに版、updatedAtにISO日時を入れてください。指定のない軸設定はnullのままです。\n${JSON.stringify(team.classPickRules||blankClassRules(),null,2)}\n参照する優先順位CSV（自動変換せず、条件の変更は私に確認）：\n${rulesToText(team.pickRules||[])}`,
  assessment:`方式：役割・危険評価。役割ごとに最大適性を1匹分だけ採点します。同じ役割IDの重要度・合格点・不足減点は一致必須です。適性は勝率ではありません。\n役割CSV：${ROLE_HEADER}\n危険CSV：${RISK_HEADER}\n初動ケースCSV：${CASE_HEADER}\n危険の自分条件は選出3体へ適用します。場面は選出/先発/対応。対応リスクはrules.riskRoleLinksで役割IDへリンクしてください。同じ危険ID・対象・場面は最大減点1回、別IDは加算です。\n未検証の初動ケースの評価は未評価。評価を付ける場合のみ、検証済み列にtrueと根拠を必須にします。未登録を安全扱いにしないでください。未提供の適性・重要度・減点・係数を推測で埋めず質問してください。初動モデルのない総合点・勝率を作らないでください。\n返答形式：次の形式のJSONオブジェクトのみ。rolesCsv、risksCsv、openingCsvに各見出し付きCSV文字列を入れます。schemaVersionは3です。\n${JSON.stringify(team.selectionAssessment||blankAssessment(),null,2)}`,
 };
 return common+instructions[mode]+'\n\n現在の自分の構築（能力PtはH/A/B/C/D/S順、技は名前とポケメモID）：\n'+JSON.stringify(mons,null,2)+'\n\n私が希望する条件・根拠：\n［ここに追加します］';
}
export function PickRuleAIHelp({team,mode}){
 const {toast}=useApp(),text=pickrulePrompt(team,mode),ref=useRef(null),[fallback,setFallback]=useState(false);
 const copy=async()=>{try{await navigator.clipboard.writeText(text);setFallback(false);toast('AI用の依頼文をコピーしました');}catch{setFallback(true);ref.current?.focus();ref.current?.select();}};
 return <details class="pickrule-ai-help"><summary>AIに作成を依頼する</summary><p class="hint">構築・保存済みの条件・選択中の入力形式をまとめた依頼文です。コピーしてAIへ貼り付け、末尾に希望を追記してください。自動送信はしません。</p><button class="btn" onClick={copy}>AI用の依頼文をコピー</button>{fallback&&<p role="status">依頼文を選択しました。コピー操作で取り出してください。</p>}<label class="field"><span>AIに送る依頼文</span><textarea ref={ref} readOnly class="input assessment-source" rows={8} value={text}/></label></details>;
}
