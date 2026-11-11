// Conta Google: botão "Entrar com Google" (login) e autorização do Google Drive (backup).
// Usa a biblioteca oficial do Google (Google Identity Services), carregada só quando precisa.

// ID público do cliente OAuth (o mesmo de server/worker.js). Não é segredo.
export const GOOGLE_CLIENT_ID = 'COLOQUE_AQUI.apps.googleusercontent.com';
export const googleReady = () => !GOOGLE_CLIENT_ID.startsWith('COLOQUE_AQUI');

const DRIVE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
let loading = null;
let credentialHandler = null;

/** Carrega a biblioteca do Google uma vez. */
export function loadGoogle() {
  if (window.google?.accounts) return Promise.resolve(window.google);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve(window.google);
      script.onerror = () => {
        loading = null;
        reject(new Error('Sem conexão com o Google.'));
      };
      document.head.append(script);
    });
  }
  return loading;
}

/** Desenha o botão oficial do Google em `element`; `onCredential` recebe o token de login. */
export async function renderGoogleButton(element, onCredential, text = 'signin_with') {
  if (!element || !googleReady()) return;
  credentialHandler = onCredential;
  const google = await loadGoogle();
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => credentialHandler?.(response.credential),
    ux_mode: 'popup',
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  element.innerHTML = '';
  google.accounts.id.renderButton(element, {
    type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text, locale: 'pt-BR', width: Math.min(element.clientWidth || 320, 400),
  });
}

/**
 * Pede ao Google a autorização do Drive (só arquivos criados pelo app).
 * Precisa ser chamado no toque do botão, com a biblioteca já carregada.
 */
export function requestDriveCode() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Carregando o Google; toque de novo em um instante.'));
      loadGoogle().catch(() => {});
      return;
    }
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      ux_mode: 'popup',
      prompt: 'consent',
      callback: (response) => (response.code ? resolve(response.code) : reject(new Error(response.error_description || 'Autorização cancelada.'))),
      error_callback: (error) => reject(new Error(error?.type === 'popup_closed' ? 'Janela do Google fechada antes de terminar.' : 'Autorização cancelada.')),
    });
    client.requestCode();
  });
}
