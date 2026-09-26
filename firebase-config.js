// Firebase 設定（Firebase 主控台 → 專案設定 → 你的應用程式）
// 這段不是密碼，放在 GitHub 公開也沒關係；真正保護日記的是 Firestore 的安全規則。
// 想暫時關掉同步，把下面改成 export const FIREBASE_CONFIG = null;
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDXUgkgF_JRypUPGstjR1IHRH7f5WnMFy4',
  authDomain: 'qiouqiou-diary.firebaseapp.com',
  projectId: 'qiouqiou-diary',
  storageBucket: 'qiouqiou-diary.firebasestorage.app',
  messagingSenderId: '163589731275',
  appId: '1:163589731275:web:8e75e1fffa5abfc0fd3c4e',
};
