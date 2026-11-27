/**
 * HUD: the overlay controls. Pure DOM — the renderer never sees it.
 */

import type { GaitName } from "../horse/gaits";
import { COATS } from "../horse/coat";

export interface HudCallbacks {
  onGait: (g: GaitName) => void;
  onRear: () => void;
  onXray: () => void;
  onSound: () => void;
  onSpin: () => void;
  onCoat: (index: number) => void;
  onHide: (hidden: boolean) => void;
}

export interface Hud {
  setSpeed: (kmh: number) => void;
  setGait: (g: GaitName) => void;
  setXray: (on: boolean) => void;
  setSound: (on: boolean) => void;
  setSpin: (on: boolean) => void;
  setCoat: (i: number) => void;
  element: HTMLElement;
}

const GAIT_BUTTONS: Array<{ id: GaitName; label: string }> = [
  { id: "stand", label: "Stand" },
  { id: "walk", label: "Walk" },
  { id: "trot", label: "Trot" },
  { id: "canter", label: "Canter" },
  { id: "gallop", label: "Gallop" },
  { id: "rear", label: "Rear" },
];

export function createHud(cb: HudCallbacks): Hud {
  const hud = document.createElement("div");
  hud.id = "hud";
  hud.innerHTML = `
    <div class="top">
      <div class="card">
        <h1>Horse</h1>
        <p>A 100% procedural horse. Meshed from signed-distance fields and
           rigged on the spot — no models, no textures, no keyframes.</p>
        <div class="keys">
          <kbd>1–5</kbd><span>stand · walk · trot · canter · gallop</span>
          <kbd>Space</kbd><span>rear up</span>
          <kbd>X</kbd><span>x-ray the skeleton</span>
          <kbd>C</kbd><span>change coat</span>
          <kbd>H</kbd><span>hide the interface</span>
          <kbd>drag</kbd><span>orbit · scroll to zoom</span>
        </div>
      </div>
      <div class="pills">
        <div class="pill readout" id="speed"><span class="dot"></span><span id="speed-text">0 km/h</span></div>
        <button class="pill" id="xray" type="button">X-ray</button>
        <button class="pill" id="sound" type="button">Sound</button>
        <button class="pill" id="spin" type="button">360°</button>
      </div>
    </div>
    <div class="bottom">
      <div class="coats">
        <span class="label">Coat</span>
        <div class="swatches" id="swatches"></div>
      </div>
      <div class="gaitbar" id="gaitbar"></div>
    </div>
  `;

  const gaitbar = hud.querySelector<HTMLDivElement>("#gaitbar")!;
  for (const g of GAIT_BUTTONS) {
    if (g.id === "rear") {
      const sep = document.createElement("div");
      sep.className = "sep";
      gaitbar.appendChild(sep);
    }
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = g.label;
    b.dataset.gait = g.id;
    b.addEventListener("click", () => {
      if (g.id === "rear") cb.onRear();
      else cb.onGait(g.id);
    });
    gaitbar.appendChild(b);
  }

  const swatches = hud.querySelector<HTMLDivElement>("#swatches")!;
  COATS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (i === 0 ? " active" : "");
    b.title = c.name;
    b.style.background = c.body;
    b.addEventListener("click", () => cb.onCoat(i));
    swatches.appendChild(b);
  });

  const speedText = hud.querySelector<HTMLSpanElement>("#speed-text")!;
  const xrayBtn = hud.querySelector<HTMLButtonElement>("#xray")!;
  const soundBtn = hud.querySelector<HTMLButtonElement>("#sound")!;
  const spinBtn = hud.querySelector<HTMLButtonElement>("#spin")!;

  xrayBtn.addEventListener("click", () => cb.onXray());
  soundBtn.addEventListener("click", () => cb.onSound());
  spinBtn.addEventListener("click", () => cb.onSpin());

  document.body.appendChild(hud);

  const setGait = (g: GaitName) => {
    for (const b of gaitbar.querySelectorAll<HTMLButtonElement>("button")) {
      b.classList.toggle("active", b.dataset.gait === g);
    }
  };
  setGait("stand");

  return {
    element: hud,
    setSpeed: (kmh: number) => {
      speedText.textContent = `${kmh.toFixed(0)} km/h`;
      document.querySelector<HTMLElement>("#speed")!.style.minWidth = "108px";
    },
    setGait,
    setXray: (on) => xrayBtn.classList.toggle("on", on),
    setSound: (on) => soundBtn.classList.toggle("on", on),
    setSpin: (on) => spinBtn.classList.toggle("on", on),
    setCoat: (i) => {
      swatches.querySelectorAll(".swatch").forEach((el, k) => el.classList.toggle("active", k === i));
    },
  };
}

export function createLoading(): {
  set: (fraction: number, label: string) => void;
  done: () => void;
  meta: (text: string) => void;
} {
  const el = document.createElement("div");
  el.id = "loading";
  el.innerHTML = `
    <div class="inner">
      <h2>Building a horse</h2>
      <p id="load-label">Sampling the signed distance field…</p>
      <div class="bar"><i id="load-bar"></i></div>
      <div class="meta"><span id="load-meta">surface nets</span><span>16hh</span></div>
    </div>
  `;
  document.body.appendChild(el);
  const bar = el.querySelector<HTMLElement>("#load-bar")!;
  const label = el.querySelector<HTMLElement>("#load-label")!;
  const meta = el.querySelector<HTMLElement>("#load-meta")!;
  return {
    set: (f, text) => {
      bar.style.width = `${Math.max(4, f * 100).toFixed(1)}%`;
      if (text) label.textContent = text;
    },
    done: () => {
      el.classList.add("done");
      setTimeout(() => el.remove(), 800);
    },
    meta: (text) => {
      meta.textContent = text;
    },
  };
}
