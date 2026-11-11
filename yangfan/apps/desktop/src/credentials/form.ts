import type { CredentialEntryBridge } from '../../../../packages/contracts/src/desktop.ts';
const bridge = (window as unknown as { credentials: CredentialEntryBridge }).credentials;
const form = document.querySelector('form')!;
const secret = document.querySelector<HTMLInputElement>('#secret')!;
const session = document.querySelector<HTMLInputElement>('#session')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const revoke = document.querySelector<HTMLButtonElement>('#revoke')!;
const message = document.querySelector<HTMLElement>('#message')!;
let available = false;
void bridge.info().then(result => {
  if (!result.ok) { message.textContent = result.error.message; return; }
  available = result.value.protectionAvailable;
  document.querySelector('#protection')!.textContent = available ? '系统保护可用。' : '系统保护不可用。请修复系统保护，或勾选仅本次会话保存。';
  revoke.hidden = !result.value.current || result.value.current.state === 'revoked';
  save.disabled = !available;
});
session.addEventListener('change', () => { save.disabled = !available && !session.checked; });
form.addEventListener('submit', event => {
  event.preventDefault(); save.disabled = true; revoke.disabled = true;
  const submitted = { secret: secret.value, mode: session.checked ? 'session' as const : 'protected' as const };
  secret.value = '';
  void bridge.submit(submitted).then(result => { submitted.secret = ''; if (!result.ok) message.textContent = result.error.message; }).catch(() => { submitted.secret = ''; message.textContent = '凭据入口已关闭，请重新打开。'; });
});
revoke.addEventListener('click', () => { secret.value = ''; save.disabled = true; revoke.disabled = true; void bridge.revoke().then(result => { if (!result.ok) message.textContent = result.error.message; }); });
window.addEventListener('pagehide', () => { secret.value = ''; });
