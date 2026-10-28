import { scriptURL } from "/omnishell/interpreter/script-url.js";
import { createShell } from "/omnishell/interpreter/shell.js";

const mount = document.getElementById("app");
if (!mount) throw new Error("boot: #app mount missing");

const shellPromise = createShell({ config: "./shell.json", mount });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(scriptURL("/offline-first-sw.js"));
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const ok = document.execCommand("copy");
  input.remove();
  return ok;
}

document.addEventListener("click", async (e) => {
  const copyBtn = e.target.closest(".stk-btn-copy");
  const codeEl = e.target.closest(".stk-lobby-code");
  if (copyBtn || codeEl) {
    const row = (copyBtn ?? codeEl).closest(".stk-lobby-link-row");
    const code = row?.querySelector(".stk-lobby-code");
    const param = code?.textContent?.trim() ?? "";
    const uuidMatch = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(param);
    if (!uuidMatch) return;
    const url = new URL(`?challenge=${uuidMatch[0]}`, window.location.href).href;
    const ok = await copyText(url);
    if (ok) {
      const btn = row?.querySelector(".stk-btn-copy");
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = "COPIED!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = orig;
          btn.classList.remove("copied");
        }, 2000);
      }
    }
    return;
  }

  const pasteBtn = e.target.closest("#btn-paste-link");
  if (pasteBtn) {
    e.preventDefault();
    const input = document.getElementById("input-challenge-link");
    if (!input) return;
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          input.value = text.trim();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
            const form = input.closest("form");
            form?.requestSubmit?.() || form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          }
          return;
        }
      }
    } catch (_) {}
    input.focus();
    input.select();
    return;
  }
});

// Auto-paste clipboard on "JOIN LINK" if input was left blank
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#btn-join-link");
  if (btn) {
    const input = document.getElementById("input-challenge-link");
    if (input && !input.value.trim() && navigator.clipboard?.readText) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(clip)) {
          input.value = clip.trim();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          const form = input.closest("form");
          form?.requestSubmit?.() || form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          return;
        }
      } catch (_) {}
      input.focus();
      input.reportValidity?.();
    }
  }
}, true);

// Auto-join if arriving via a shared challenge link
const challengeParam = new URLSearchParams(window.location.search).get("challenge");
const challengeUuid = challengeParam ? /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(challengeParam)?.[0]?.toLowerCase() : null;

if (challengeUuid) {
  window.history.replaceState({}, "", window.location.pathname);
  shellPromise.then(async ({ store }) => {
    // If lobby is not yet open/leased, click ONLINE DUEL button to initialize presence & lease
    for (let i = 0; i < 50; i++) {
      const btn = document.getElementById("stk-btn-lobby");
      if (btn) {
        btn.click();
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    for (let i = 0; i < 50; i++) {
      const [tab] = await store.query("lobby_tab", null, { current: true });
      if (tab?.lease) {
        await store.patch("lobby_tab", [{
          key: "the",
          changes: { open: "yes", shown: "show", join: challengeUuid }
        }]);
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }
  });
}
