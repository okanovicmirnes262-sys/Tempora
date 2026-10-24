"use client";

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIOS() {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

function urlB64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Traži dozvolu i vraća pretplatu (endpoint + ključevi) ili baca grešku s porukom na hrvatskom. */
export async function subscribePush(): Promise<{ endpoint: string; p256dh: string; auth: string }> {
  if (!pushSupported()) {
    throw new Error(isIOS() && !isStandalone()
      ? "Na iPhoneu prvo dodaj aplikaciju na početni zaslon, pa je otvori odande."
      : "Ovaj preglednik ne podržava obavijesti.");
  }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("Obavijesti još nisu podešene (VAPID ključ).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Obavijesti nisu dopuštene. Uključi ih u postavkama preglednika.");
  const reg = (await registerSW()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) }));
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth };
}

export async function hasPushSubscription() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return !!(await reg?.pushManager.getSubscription());
}
