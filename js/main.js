import { getSession, onAuthChange, sendLoginLink } from './store.js';
import { startApp, stopApp } from './ui.js';

const loading = document.getElementById('loading');
const loginScreen = document.getElementById('login-screen');
const appRoot = document.getElementById('app');
const loginMessage = document.getElementById('login-message');

let started = false;

function show(session) {
  loading.hidden = true;
  loginScreen.hidden = Boolean(session);
  appRoot.hidden = !session;
  if (session && !started) { started = true; startApp(); }
  if (!session && started) { started = false; stopApp(); }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  if (!email) return;
  loginMessage.textContent = '보내는 중…';
  try {
    await sendLoginLink(email);
    loginMessage.textContent = '메일함에서 로그인 링크를 눌러주세요.';
  } catch (err) {
    console.error(err);
    loginMessage.textContent = '로그인 링크를 보내지 못했어요. 허용된 이메일인지 확인해주세요.';
  }
});

onAuthChange(show);
getSession().then(show).catch((err) => { console.error(err); show(null); });
