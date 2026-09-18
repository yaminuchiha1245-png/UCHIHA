import { registerPlugin } from "./capacitor-core.js";

const SocialLogin = registerPlugin("SocialLogin");
let initializedClientId = null;

async function initializeGoogle(webClientId) {
  if (!webClientId) throw new Error("معرّف Google غير مضبوط على الخادم");
  if (initializedClientId === webClientId) return;
  await SocialLogin.initialize({
    google: {
      webClientId,
      mode: "online"
    }
  });
  initializedClientId = webClientId;
}

async function signInWithGoogle(webClientId) {
  await initializeGoogle(webClientId);
  const response = await SocialLogin.login({
    provider: "google",
    options: {
      style: "bottom",
      filterByAuthorizedAccounts: false,
      autoSelectEnabled: false
    }
  });
  const idToken = response?.result?.idToken;
  if (!idToken) throw new Error("لم يُرجع Google رمز هوية صالحًا");
  return idToken;
}

async function signOut() {
  if (!initializedClientId) return;
  await SocialLogin.logout({ provider: "google" });
}

window.UchihaNativeAuth = Object.freeze({ initializeGoogle, signInWithGoogle, signOut });
