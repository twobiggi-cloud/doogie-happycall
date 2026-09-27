import { getSession, onAuthChange, signInWithPassword } from './store.js';
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
const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const LAST_EMAIL_KEY = 'happycall-last-email';

// 마지막으로 성공한 이메일은 그 브라우저에만 기억한다. 비밀번호는 기억하지 않는다.
try {
  const saved = localStorage.getItem(LAST_EMAIL_KEY);
  if (saved) {
    emailInput.value = saved;
    passwordInput.focus();
  }
} catch (err) {
  console.error(err);
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password || loginButton.disabled) return;
  loginButton.disabled = true;
  loginMessage.textContent = '들어가는 중…';
  try {
    await signInWithPassword(email, password);
    try { localStorage.setItem(LAST_EMAIL_KEY, email); } catch (err) { console.error(err); }
    passwordInput.value = '';
    loginMessage.textContent = '';
  } catch (err) {
    console.error(err);
    loginMessage.textContent = err?.status === 429
      ? '로그인을 너무 자주 시도했어요. 잠시 뒤 다시 해주세요.'
      : '이메일이나 비밀번호가 맞지 않아요. 원장님께 확인해주세요.';
  } finally {
    loginButton.disabled = false;
  }
});

onAuthChange(show);
getSession().then(show).catch((err) => { console.error(err); show(null); });
