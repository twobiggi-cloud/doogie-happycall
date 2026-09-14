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

const loginButton = document.querySelector('#login-form button[type="submit"]');

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  if (!email || loginButton.disabled) return;
  loginButton.disabled = true;
  loginMessage.textContent = '보내는 중…';
  try {
    await sendLoginLink(email);
    loginMessage.textContent = '메일이 왔으면 링크를 이 PC에서 눌러주세요. 1분 안에는 다시 보내지 않아요.';
    setTimeout(() => { loginButton.disabled = false; }, 60000);
  } catch (err) {
    console.error(err);
    loginButton.disabled = false;
    loginMessage.textContent = err?.status === 429
      ? '메일을 너무 자주 보냈어요. 이미 받은 링크가 있으면 그 링크를 이 PC에서 눌러주세요. 없으면 잠시 뒤 다시 시도해주세요.'
      : '로그인 링크를 보내지 못했어요. 허용된 이메일인지 확인해주세요.';
  }
});

onAuthChange(show);
getSession().then(show).catch((err) => { console.error(err); show(null); });
