/**
 * Scoped stylesheet for the stage tab.
 *
 * The browser bundle has no CSS pipeline, and the tab needs keyframes,
 * pseudo-elements, and hover/focus states that inline styles cannot express.
 * One `<style data-ui-sidebar-stage>` element is installed with the plugin
 * fiber and removed on disposal; every selector is prefixed `ui-stage-` and
 * every colour resolves through a `--dsw-*` token, so light/dark themes work
 * without an override. The only literal colours are the per-stage identity
 * accents, which are decorative dots/lines and never carry text contrast.
 */

/** Absolute style text; imported by the apply-time installer below. */
export const STAGE_CSS = `
.ui-stage-root {
  --ui-stage-accent: var(--dsw-alias-state-business-primary);
  --ui-stage-accent-ink: color-mix(in srgb, var(--ui-stage-accent) 78%, var(--dsw-alias-label-primary));
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
  padding: 16px 16px 24px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}

body[data-ds-dark-theme] .ui-stage-root {
  --ui-stage-accent-ink: var(--ui-stage-accent);
}

.ui-stage-root *,
.ui-stage-root *::before,
.ui-stage-root *::after {
  box-sizing: border-box;
}

/* ---------- empty state ---------- */

.ui-stage-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 16px;
  text-align: center;
}

.ui-stage-empty-ring {
  position: relative;
  width: 74px;
  height: 74px;
  margin-bottom: 6px;
  border: 1.5px dashed color-mix(in srgb, var(--dsw-alias-label-tertiary) 45%, transparent);
  border-radius: 50%;
}

.ui-stage-empty-ring::before,
.ui-stage-empty-ring::after {
  position: absolute;
  content: '';
  border-radius: 50%;
}

.ui-stage-empty-ring::before {
  inset: 12px;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--ui-stage-accent) 18%, transparent), transparent 76%);
}

.ui-stage-empty-ring::after {
  top: 16px;
  left: 50%;
  width: 5px;
  height: 5px;
  margin-left: -2.5px;
  background: var(--ui-stage-accent);
  box-shadow: 0 0 10px 2px color-mix(in srgb, var(--ui-stage-accent) 55%, transparent);
}

.ui-stage-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.ui-stage-empty-hint {
  max-width: 260px;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.ui-stage-empty-action {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  margin-top: 4px;
  padding: 0 13px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: 500 12px/1 inherit;
  cursor: pointer;
  box-shadow: var(--dsw-elevation-panel);
}

.ui-stage-empty-action:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

/* ---------- hero ---------- */

.ui-stage-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 14px 16px;
  border: 0.5px solid color-mix(in srgb, var(--ui-stage-accent) 24%, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-xl);
  background:
    linear-gradient(158deg,
      color-mix(in srgb, var(--ui-stage-accent) 11%, var(--dsw-alias-bg-layer-1)) 0%,
      var(--dsw-alias-bg-layer-1) 52%,
      color-mix(in srgb, var(--ui-stage-accent) 3%, var(--dsw-alias-bg-layer-1)) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white 32%, transparent),
    0 12px 32px -18px color-mix(in srgb, var(--ui-stage-accent) 55%, transparent);
}

.ui-stage-hero::before {
  position: absolute;
  inset: -92px -64px auto auto;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--ui-stage-accent) 26%, transparent), transparent 78%);
  content: '';
  pointer-events: none;
}

.ui-stage-hero::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 22%, color-mix(in srgb, white 7%, transparent) 42%, transparent 58%);
  content: '';
  pointer-events: none;
}

.ui-stage-hero-top,
.ui-stage-hero-main,
.ui-stage-rail,
.ui-stage-hero-foot {
  position: relative;
  z-index: 1;
}

.ui-stage-hero-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ui-stage-eyebrow {
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 14px;
  text-transform: uppercase;
}

.ui-stage-hero-top .ui-stage-spacer {
  flex: 1;
}

.ui-stage-live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-stage-accent) 13%, transparent);
  color: var(--ui-stage-accent-ink);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
}

.ui-stage-live--idle {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  color: var(--dsw-alias-label-tertiary);
}

.ui-stage-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 16%, transparent);
  animation: ui-stage-live 2.2s ease-in-out infinite;
}

.ui-stage-live--idle .ui-stage-live-dot {
  animation: none;
}

.ui-stage-hero-main {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
}

.ui-stage-ring {
  position: relative;
  flex: none;
  width: 74px;
  height: 74px;
}

.ui-stage-ring-aura {
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--ui-stage-accent) 24%, transparent), transparent 72%);
  filter: blur(4px);
  animation: ui-stage-aura 4.6s ease-in-out infinite;
}

.ui-stage-ring-spin {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 224deg,
    transparent 0deg 58deg,
    color-mix(in srgb, var(--ui-stage-accent) 30%, transparent) 88deg,
    var(--ui-stage-accent) 118deg,
    color-mix(in srgb, white 70%, var(--ui-stage-accent)) 136deg,
    transparent 178deg 360deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  animation: ui-stage-spin 9s linear infinite;
}

.ui-stage-ring-track {
  position: absolute;
  inset: 0;
  border: 1px solid color-mix(in srgb, var(--ui-stage-accent) 30%, var(--dsw-alias-border-l2));
  border-radius: 50%;
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-stage-accent) 18%, transparent);
}

.ui-stage-ring-orbit {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  animation: ui-stage-spin 9s linear infinite;
  pointer-events: none;
}

.ui-stage-ring-orbit::before {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 5px;
  height: 5px;
  margin-left: -2.5px;
  border-radius: 50%;
  background: color-mix(in srgb, white 55%, var(--ui-stage-accent));
  box-shadow: 0 0 8px 2px color-mix(in srgb, var(--ui-stage-accent) 65%, transparent);
  content: '';
}

.ui-stage-ring-inner {
  position: absolute;
  inset: 7px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 0.5px solid color-mix(in srgb, var(--ui-stage-accent) 18%, var(--dsw-alias-border-l1));
  border-radius: 50%;
  background:
    radial-gradient(80% 80% at 30% 20%, color-mix(in srgb, white 28%, transparent), transparent 60%),
    var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--ui-stage-accent) 8%, transparent);
}

.ui-stage-ring-index {
  font-size: 19px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 19px;
}

.ui-stage-ring-total {
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
  line-height: 11px;
}

.ui-stage-copy {
  flex: 1;
  min-width: 0;
}

.ui-stage-name {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 27px;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.05;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.ui-stage-name--long {
  font-size: 21px;
  line-height: 1.12;
}

.ui-stage-brief {
  display: -webkit-box;
  overflow: hidden;
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 16px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.ui-stage-rail {
  display: flex;
  gap: 4px;
  margin-top: 14px;
}

.ui-stage-seg {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
}

.ui-stage-seg--done {
  background: color-mix(in srgb, var(--ui-stage-accent) 34%, transparent);
}

.ui-stage-seg--now {
  background: var(--ui-stage-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-stage-accent) 70%, transparent);
}

.ui-stage-hero-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 11px;
}

.ui-stage-hero-foot .ui-stage-spacer {
  flex: 1;
}

.ui-stage-clock {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.ui-stage-in-stage {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.ui-stage-in-stage b {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  font-weight: 550;
}

.ui-stage-ctx {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ui-stage-ctx-label {
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.ui-stage-ctx-track {
  width: 56px;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
}

.ui-stage-ctx-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--ui-stage-accent) 55%, var(--dsw-alias-state-success-primary)),
    var(--ui-stage-accent));
}

.ui-stage-ctx-value {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.ui-stage-requested {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  overflow: hidden;
  color: var(--ui-stage-accent-ink);
  font-size: 10px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-stage-requested::before {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 14%, transparent);
  content: '';
  animation: ui-stage-live 1.6s ease-in-out infinite;
}

/* ---------- metrics ---------- */

.ui-stage-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent);
}

.ui-stage-metric {
  position: relative;
  padding: 9px 11px 8px;
}

.ui-stage-metric + .ui-stage-metric::before {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 0.5px;
  background: var(--dsw-alias-border-l1);
  content: '';
}

.ui-stage-metric-value {
  display: block;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 18px;
}

.ui-stage-metric-label {
  display: block;
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 12px;
  text-transform: uppercase;
}

/* ---------- section and journey ---------- */

.ui-stage-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 1px -2px;
}

.ui-stage-section-label {
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ui-stage-section .ui-stage-spacer {
  flex: 1;
}

.ui-stage-section-count {
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.ui-stage-note {
  margin: -4px 1px 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 15px;
}

.ui-stage-journey {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ui-stage-spine {
  position: absolute;
  top: 16px;
  bottom: 18px;
  left: 12px;
  width: 1px;
  background: linear-gradient(to bottom,
    color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent) 0%,
    color-mix(in srgb, var(--ui-stage-accent) 38%, transparent) 55%,
    var(--dsw-alias-border-l2) 82%,
    transparent 100%);
}

.ui-stage-row {
  position: relative;
  border-radius: 12px;
}

.ui-stage-row-button {
  position: relative;
  display: block;
  width: 100%;
  min-height: 48px;
  padding: 8px 8px 8px 32px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ui-stage-row-button:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--ui-stage-accent));
  outline-offset: 1px;
}

.ui-stage-row--switchable .ui-stage-row-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ui-stage-row--current .ui-stage-row-button {
  background: linear-gradient(100deg,
    color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 8%, transparent),
    color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 2%, transparent) 70%);
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 20%, transparent);
  cursor: default;
}

.ui-stage-node {
  position: absolute;
  top: 18px;
  left: 7px;
  z-index: 1;
  width: 11px;
  height: 11px;
  border: 2px solid var(--ui-stage-node, var(--dsw-alias-border-l3));
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1);
}

.ui-stage-row--current .ui-stage-node {
  top: 17px;
  left: 6px;
  width: 13px;
  height: 13px;
  border: 2.5px solid var(--dsw-alias-bg-layer-1);
  background: var(--ui-stage-node, var(--ui-stage-accent));
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 22%, transparent),
    0 0 14px color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 55%, transparent);
  animation: ui-stage-node 2.8s ease-in-out infinite;
}

.ui-stage-row--future .ui-stage-node {
  border-color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 32%, transparent);
  opacity: 0.75;
}

.ui-stage-row-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
}

.ui-stage-row-name {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.ui-stage-row--done .ui-stage-row-name {
  color: var(--dsw-alias-label-secondary);
}

.ui-stage-row--future .ui-stage-row-name {
  color: var(--dsw-alias-label-tertiary);
}

.ui-stage-row--current .ui-stage-row-name {
  font-weight: 600;
}

.ui-stage-now {
  padding: 1.5px 5px 1px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 12%, transparent);
  color: var(--ui-stage-accent-ink);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 12px;
  text-transform: uppercase;
}

.ui-stage-row-top .ui-stage-spacer {
  flex: 1;
}

.ui-stage-row-time {
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 15px;
}

.ui-stage-row-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 1px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 15px;
}

.ui-stage-row-dot {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}

.ui-stage-live-ink {
  color: var(--ui-stage-accent-ink);
}

.ui-stage-error-ink {
  color: var(--dsw-alias-state-error-primary);
}

.ui-stage-row-hint {
  position: absolute;
  top: 50%;
  right: 9px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  transform: translateY(-50%);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
  opacity: 0;
  transition: opacity 140ms ease;
  pointer-events: none;
}

.ui-stage-row--switchable .ui-stage-row-button:hover .ui-stage-row-hint {
  opacity: 1;
}

.ui-stage-row--switchable .ui-stage-row-button:hover .ui-stage-row-time {
  opacity: 0;
}

/* ---------- switch ---------- */

.ui-stage-switch {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 42px;
  margin-top: 2px;
  padding: 0 11px 0 13px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: 500 12.5px/1 inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: var(--dsw-elevation-panel);
  transition: background 140ms ease, border-color 140ms ease;
}

.ui-stage-switch:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.ui-stage-switch:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--ui-stage-accent));
  outline-offset: 2px;
}

.ui-stage-switch-glyph {
  display: inline-flex;
  flex: none;
  color: var(--ui-stage-accent);
}

.ui-stage-switch .ui-stage-spacer {
  flex: 1;
}

.ui-stage-kbd {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font: 500 10px/1 var(--ds-font-family-code);
}

/* ---------- failure ---------- */

.ui-stage-failure {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 16px;
}

.ui-stage-failure-message {
  min-width: 0;
  overflow-wrap: anywhere;
  opacity: 0.9;
}

/* ---------- palette ---------- */

.ui-stage-palette-wrap {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  padding: 8px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 22%, transparent);
}

.ui-stage-palette {
  width: 100%;
  max-height: min(70vh, 460px);
  overflow: auto;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 94%, transparent);
  backdrop-filter: blur(30px) saturate(140%);
  box-shadow: var(--dsw-elevation-prominent);
}

.ui-stage-search {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 46px;
  padding: 0 13px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}

.ui-stage-search-icon {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.ui-stage-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: 400 13px/1 inherit;
}

.ui-stage-search-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.ui-stage-palette-group {
  padding: 8px 6px 4px;
}

.ui-stage-palette-label {
  padding: 3px 8px 5px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  font-weight: 650;
  letter-spacing: 0.12em;
  line-height: 12px;
  text-transform: uppercase;
}

.ui-stage-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ui-stage-option:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.ui-stage-option--selected {
  background: color-mix(in srgb, var(--ui-stage-accent) 9%, transparent);
}

.ui-stage-option--disabled {
  cursor: default;
  opacity: 0.7;
}

.ui-stage-option-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-stage-option-color, var(--ui-stage-accent));
}

.ui-stage-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-stage-option-hint {
  flex: none;
  max-width: 96px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-stage-option-meta {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 15px;
}

.ui-stage-option-enter {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.ui-stage-palette-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 13px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  line-height: 14px;
}

.ui-stage-palette-foot .ui-stage-spacer {
  flex: 1;
}

.ui-stage-palette-foot b {
  color: var(--dsw-alias-label-secondary);
  font-weight: 550;
}


/* ---------- ambient surfaces ---------- */

.ui-stage-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.ui-stage-title-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.ui-stage-title-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-stage-dock {
  box-sizing: border-box;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  max-width: calc(
    var(--dsh-composer-card-max-width) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  margin: 0 auto;
}

.ui-stage-dock-bar {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 8px 0 12px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  text-align: left;
  cursor: pointer;
}

.ui-stage-dock-bar:hover {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 55%, var(--dsw-specific-menu));
}

.ui-stage-dock-bar:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.ui-stage-dock-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-stage-dock-color, var(--dsw-alias-state-business-primary));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-stage-dock-color, var(--dsw-alias-state-business-primary)) 16%, transparent);
}

.ui-stage-dock-dot--live {
  animation: ui-stage-live 2.2s ease-in-out infinite;
}

.ui-stage-dock-name {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-stage-dock-meta {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
}

.ui-stage-dock-spacer {
  flex: 1;
}

.ui-stage-dock-chevron {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

/* ---------- motion ---------- */

@keyframes ui-stage-spin {
  to { transform: rotate(360deg); }
}

@keyframes ui-stage-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@keyframes ui-stage-aura {
  0%, 100% { opacity: 0.75; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.06); }
}

@keyframes ui-stage-node {
  0%, 100% {
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 18%, transparent),
      0 0 10px color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 35%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 5px color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 9%, transparent),
      0 0 18px color-mix(in srgb, var(--ui-stage-node, var(--ui-stage-accent)) 60%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-stage-ring-spin,
  .ui-stage-ring-orbit,
  .ui-stage-ring-aura,
  .ui-stage-live-dot,
  .ui-stage-row--current .ui-stage-node,
  .ui-stage-requested::before {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
  }

  .ui-stage-row-hint,
  .ui-stage-switch {
    transition: none;
  }
}
`

/** The style element's identifying attribute. */
const STYLE_ATTRIBUTE = 'data-ui-sidebar-stage-styles'

/**
 * Install the tab stylesheet once per document, returning its disposer.
 * A second installation (a second plugin instance in tests, or an HMR
 * overlap) reuses the existing element; the disposer never removes an element
 * this call did not create.
 * @returns cleanup for the style element created by this call.
 */
export function installStageStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[${STYLE_ATTRIBUTE}]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTRIBUTE, '')
  style.textContent = STAGE_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
