import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Backdrop } from "./components/Backdrop";
import { TripProvider } from "./trip";
import { captureInvite } from "./supabase";
import { captureFriend } from "./friends";
import { capturePocketLink } from "./pocket";
import "./styles.css";

captureInvite();
captureFriend();
capturePocketLink();

// Offline support (production build only): the worker keeps the page, the app's files and the coupon pictures on the phone.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then((reg) => {
      // this page's own script and stylesheet were fetched before the worker was in control: hand it their addresses
      const urls = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]')]
        .map((el) => (el instanceof HTMLScriptElement ? el.src : el.href))
        .filter((u) => u.startsWith(location.origin));
      reg.active?.postMessage({ type: "assets", urls });
    }).catch(() => { /* no offline support in this browser: the site still works online */ });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TripProvider>
      <Backdrop />
      <App />
    </TripProvider>
  </StrictMode>,
);
