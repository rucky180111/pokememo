// Firebase の部品 (アカウント同期を使うときだけ読み込む別ファイル docs/cloud.js になる)
import {initializeApp, deleteApp} from 'firebase/app';
import {getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail} from 'firebase/auth';
import {getFirestore, collection, doc, setDoc, onSnapshot} from 'firebase/firestore';

const COL = {team: 'teams', battle: 'battles'};
const JA = {
  'auth/invalid-email': 'メールアドレスの形が正しくありません',
  'auth/missing-password': 'パスワードを入れてください',
  'auth/weak-password': 'パスワードは6文字以上にしてください',
  'auth/email-already-in-use': 'このメールアドレスはもう登録されています。「ログイン」を使ってください',
  'auth/invalid-credential': 'メールアドレスかパスワードが違います',
  'auth/wrong-password': 'メールアドレスかパスワードが違います',
  'auth/user-not-found': 'このメールアドレスは登録されていません。「新しく登録」を使ってください',
  'auth/too-many-requests': '試行回数が多すぎます。少し待ってからやり直してください',
  'auth/network-request-failed': 'ネットにつながっていません',
  'auth/operation-not-allowed': 'Firebase で「メール/パスワード」のログインが有効になっていません',
  'auth/invalid-api-key': '設定の apiKey が正しくありません。firebaseConfig を貼り直してください',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': '設定の apiKey が正しくありません。firebaseConfig を貼り直してください',
  'permission-denied': 'データベースのルールで拒否されました。手順のルールを貼り付けて「公開」したか確認してください',
  'unavailable': 'データベースにつながりません (通信状況を確認してください)',
  'not-found': 'データベース (Firestore) がまだ作られていません',
};
export const message = e => JA[e?.code] || e?.message || String(e);

export function connect(config) {
  const app = initializeApp(config, `pokememo-${Date.now()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  return {
    onUser: cb => onAuthStateChanged(auth, u => cb(u ? {uid: u.uid, email: u.email} : null)),
    signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => createUserWithEmailAndPassword(auth, email, pw),
    reset: email => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    close: () => deleteApp(app),
    adapter(uid) {
      return {
        listen(kind, onChanges, onError) {
          return onSnapshot(collection(db, 'users', uid, COL[kind]), snap => {
            const ch = snap.docChanges().filter(c => c.type !== 'removed' && !c.doc.metadata.hasPendingWrites).map(c => ({id: c.doc.id, ...c.doc.data()}));
            onChanges(ch);
          }, e => onError?.(new Error(message(e))));
        },
        put: (kind, id, data) => setDoc(doc(db, 'users', uid, COL[kind], id), data).catch(e => { throw new Error(message(e)); }),
      };
    },
  };
}
