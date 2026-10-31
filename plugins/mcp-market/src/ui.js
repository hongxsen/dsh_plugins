/**
 * Browser half of the MCP Market plugin.
 *
 * The panel has two views: Discover searches the official registry; Installed
 * lists managed rows and read-only external rows. A detail page hosts the
 * install form. Every visible string comes from the dictionaries injected by
 * `build.mjs`; every request goes through the Host route so the browser never
 * talks to the registry directly.
 */

const h = React.createElement

/** Error and warning dictionary lookups live in `model.mjs`. */

/** Styles are injected by the entry and removed on dispose. */
const MCP_CSS = `
.dshmcp-page {
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 clamp(24px, 4vw, 48px) 48px;
  color: var(--dsw-alias-label-primary);
  --dshmcp-hairline: var(--dsw-alias-border-l2);
}
.dshmcp-inner {
  box-sizing: border-box;
  width: 100%;
  max-width: 1040px;
  display: flex;
  flex-direction: column;
}
.dshmcp-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 28px;
}
[data-platform='darwin'] .dshmcp-head {
  padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px));
}
.dshmcp-title {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
}
.dshmcp-intro {
  margin: 0;
  max-width: 720px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dshmcp-tabs {
  display: flex;
  gap: 22px;
  margin-top: 20px;
  border-bottom: 1px solid var(--dshmcp-hairline);
}
.dshmcp-tab {
  position: relative;
  border: 0;
  padding: 7px 1px 9px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dshmcp-tab:hover { color: var(--dsw-alias-label-primary); }
.dshmcp-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.dshmcp-tab[aria-selected='true']::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--dsw-alias-label-primary);
}
.dshmcp-tab:focus-visible,
.dshmcp-btn:focus-visible,
.dshmcp-iconBtn:focus-visible,
.dshmcp-switch:focus-visible,
.dshmcp-card:focus-visible,
.dshmcp-choice:focus-within,
.dshmcp-back:focus-visible,
.dshmcp-link:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}
.dshmcp-tabCount {
  margin-left: 5px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dshmcp-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}
.dshmcp-searchBox {
  position: relative;
  flex: 1;
  min-width: 0;
}
.dshmcp-searchIcon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  color: var(--dsw-alias-label-tertiary);
  pointer-events: none;
}
.dshmcp-searchInput {
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 0 40px 0 36px;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.dshmcp-searchInput::placeholder { color: var(--dsw-alias-label-tertiary); }
.dshmcp-searchInput:focus-visible {
  border-color: transparent;
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}
.dshmcp-searchClear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshmcp-searchClear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshmcp-srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.dshmcp-busy {
  height: 2px;
  margin-top: 8px;
  border-radius: 2px;
  background: var(--dsw-alias-brand-primary);
  opacity: 0;
  transition: opacity 160ms ease;
}
.dshmcp-busy[data-on='true'] {
  opacity: 0.55;
  animation: dshmcp-pulse 1.1s ease-in-out infinite;
}
@keyframes dshmcp-pulse {
  0%, 100% { opacity: 0.22; }
  50% { opacity: 0.62; }
}
.dshmcp-metaLine {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 18px;
  margin-top: 16px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12.5px;
  line-height: 18px;
}
.dshmcp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.dshmcp-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-height: 164px;
  padding: 16px;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .dshmcp-card:hover {
    border-color: var(--dsw-alias-border-l3);
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dshmcp-cardHead {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.dshmcp-cardTitles { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dshmcp-cardTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.dshmcp-cardName,
.dshmcp-mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  line-height: 16px;
}
.dshmcp-cardDesc {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  min-height: 40px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.dshmcp-cardFoot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: auto;
}
.dshmcp-cardDate {
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  line-height: 18px;
  white-space: nowrap;
}
.dshmcp-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
}
.dshmcp-badgeBrand {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.dshmcp-badgeWarn {
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-label-secondary));
}
.dshmcp-badgeSuccess {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
  color: var(--dsw-alias-state-success-secondary, var(--dsw-alias-label-secondary));
}
.dshmcp-avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: hsl(var(--dshmcp-hue) 52% 92%);
  color: hsl(var(--dshmcp-hue) 42% 30%);
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
body[data-ds-dark-theme] .dshmcp-avatar {
  background: hsl(var(--dshmcp-hue) 30% 26%);
  color: hsl(var(--dshmcp-hue) 58% 78%);
}
.dshmcp-avatarLg { width: 52px; height: 52px; border-radius: 12px; font-size: 20px; }
.dshmcp-avatarSm { width: 34px; height: 34px; border-radius: 9px; font-size: 14px; }
.dshmcp-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-top: 20px;
}
.dshmcp-back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12.5px;
  line-height: 20px;
  cursor: pointer;
}
.dshmcp-back:hover { color: var(--dsw-alias-label-primary); }
.dshmcp-detailHead {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
}
.dshmcp-detailTitles { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dshmcp-detailTitle {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 28px;
  overflow-wrap: anywhere;
}
.dshmcp-detailName {
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  white-space: normal;
}
.dshmcp-detailBadges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.dshmcp-desc {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 22px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.dshmcp-section { display: flex; flex-direction: column; gap: 10px; }
.dshmcp-sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dshmcp-sectionTitle { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; }
.dshmcp-facts {
  margin: 0;
  border-top: 1px solid var(--dshmcp-hairline);
}
.dshmcp-facts > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  min-height: 40px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--dshmcp-hairline);
}
.dshmcp-facts dt { flex: none; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dshmcp-facts dd {
  min-width: 0;
  margin: 0;
  text-align: end;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 20px;
}
.dshmcp-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-link, var(--dsw-alias-brand-primary));
  text-decoration: none;
  overflow-wrap: anywhere;
}
.dshmcp-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.dshmcp-trust {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dshmcp-trust > svg { flex: none; margin-top: 2px; color: var(--dsw-alias-state-warn-primary); }
.dshmcp-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshmcp-panelHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dshmcp-panelTitle { margin: 0; font-size: 15px; font-weight: 500; line-height: 22px; }
.dshmcp-panelHint { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshmcp-choiceList { display: flex; flex-direction: column; gap: 8px; }
.dshmcp-choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
}
.dshmcp-choice[data-active='true'] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshmcp-choice[data-disabled='true'] { opacity: 0.55; cursor: not-allowed; }
.dshmcp-choice input { flex: none; width: 15px; height: 15px; margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }
.dshmcp-choiceMain { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dshmcp-choiceTitle { font-size: 13px; font-weight: 500; line-height: 20px; }
.dshmcp-choiceDetail {
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  line-height: 17px;
  overflow-wrap: anywhere;
}
.dshmcp-fields { display: flex; flex-direction: column; gap: 12px; }
.dshmcp-field { display: flex; flex-direction: column; gap: 6px; }
.dshmcp-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
.dshmcp-labelCode { font-family: var(--ds-font-family-code); font-size: 12px; }
.dshmcp-inputRow { position: relative; display: flex; align-items: center; }
.dshmcp-input,
.dshmcp-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 0 12px;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.dshmcp-input { height: 38px; }
.dshmcp-textarea {
  min-height: 58px;
  padding: 9px 12px;
  resize: vertical;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
}
.dshmcp-textarea[data-secret='true'] { -webkit-text-security: disc; }
.dshmcp-input:focus-visible,
.dshmcp-textarea:focus-visible {
  border-color: transparent;
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 1px;
}
.dshmcp-input[aria-invalid='true'],
.dshmcp-textarea[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
.dshmcp-inputWithReveal { padding-right: 64px; }
.dshmcp-reveal {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dshmcp-reveal:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshmcp-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshmcp-fieldError { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dshmcp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshmcp-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  white-space: nowrap;
}
@media (hover: hover) {
  .dshmcp-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshmcp-btn:disabled { opacity: 0.5; cursor: default; }
.dshmcp-btnPrimary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (hover: hover) {
  .dshmcp-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
}
.dshmcp-btnDanger {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
}
@media (hover: hover) {
  .dshmcp-btnDanger:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger, color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent));
  }
}
.dshmcp-iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
@media (hover: hover) {
  .dshmcp-iconBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
.dshmcp-iconBtn:disabled { opacity: 0.45; cursor: default; }
.dshmcp-callout {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 18px;
}
.dshmcp-callout > svg { flex: none; margin-top: 2px; }
.dshmcp-calloutBody { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshmcp-calloutWarn { background: var(--dsw-alias-state-warn-tertiary); }
.dshmcp-calloutWarn > svg { color: var(--dsw-alias-state-warn-primary); }
.dshmcp-calloutError {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-state-error-primary);
}
.dshmcp-calloutSuccess {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-label-primary);
}
.dshmcp-calloutSuccess > svg { color: var(--dsw-alias-state-success-secondary, var(--dsw-alias-state-success-primary)); }
.dshmcp-code {
  margin: 0;
  padding: 10px 12px;
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  line-height: 17px;
  white-space: pre;
}
.dshmcp-infoBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 9px 12px;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dshmcp-infoBar code {
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.dshmcp-installed { display: flex; flex-direction: column; gap: 20px; padding-top: 20px; }
.dshmcp-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.dshmcp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 2px;
  border-bottom: 1px solid var(--dshmcp-hairline);
}
.dshmcp-row:last-child { border-bottom: 0; }
.dshmcp-rowMain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dshmcp-rowTitleRow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.dshmcp-rowTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 20px;
}
.dshmcp-row[data-enabled='false'] .dshmcp-rowTitle { color: var(--dsw-alias-label-secondary); }
.dshmcp-rowMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 17px; }
.dshmcp-rowMeta code { font-family: var(--ds-font-family-code); overflow-wrap: anywhere; }
.dshmcp-rowEnd { flex: none; display: flex; align-items: center; gap: 8px; }
.dshmcp-switch {
  position: relative;
  width: 34px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
  transition: background 160ms ease;
}
.dshmcp-switch[data-on='true'] { background: var(--dsw-alias-brand-primary); }
.dshmcp-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 160ms ease;
}
.dshmcp-switch[data-on='true']::after { transform: translateX(14px); }
.dshmcp-switch:disabled { opacity: 0.5; cursor: default; }
.dshmcp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 16px;
  text-align: center;
}
.dshmcp-stateIcon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
}
.dshmcp-stateIconError { color: var(--dsw-alias-state-error-primary); }
.dshmcp-stateTitle { margin: 4px 0 0; font-size: 14px; font-weight: 500; line-height: 20px; }
.dshmcp-stateBody { margin: 0; max-width: 440px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.dshmcp-stateCode { margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font-family: var(--ds-font-family-code); font-size: 11.5px; line-height: 17px; }
.dshmcp-skel {
  border-radius: 6px;
  background: var(--dsw-alias-bg-skeleton);
  animation: dshmcp-skeleton 2s cubic-bezier(0.36, 0, 0.64, 1) infinite;
}
.dshmcp-cardSkel { min-height: 164px; cursor: default; }
.dshmcp-skelRow { display: flex; align-items: center; gap: 12px; padding: 14px 2px; }
.dshmcp-skelCircle { width: 34px; height: 34px; border-radius: 9px; flex: none; }
.dshmcp-skelLines { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.dshmcp-skelLine { height: 10px; }
.dshmcp-skelLineShort { width: 45%; }
@keyframes dshmcp-skeleton {
  0% { opacity: 1; }
  40% { opacity: 0.6; }
  80%, 100% { opacity: 1; }
}
.dshmcp-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 25%, transparent);
  border-top-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: dshmcp-spin 0.8s linear infinite;
}
@keyframes dshmcp-spin { to { transform: rotate(360deg); } }
.dshmcp-toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.dshmcp-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 220px;
  max-width: 380px;
  padding: 10px 12px;
  border: 1px solid var(--dshmcp-hairline);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
.dshmcp-toast > svg { flex: none; margin-top: 2px; }
.dshmcp-toastText { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dshmcp-toastSuccess > svg { color: var(--dsw-alias-state-success-secondary, var(--dsw-alias-state-success-primary)); }
.dshmcp-toastError > svg { color: var(--dsw-alias-state-error-primary); }
.dshmcp-toastClose {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-xs);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshmcp-toastClose:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshmcp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
}
.dshmcp-dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(440px, 100%);
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.2));
}
.dshmcp-dialogTitle { margin: 0; font-size: 15px; font-weight: 500; line-height: 22px; }
.dshmcp-dialogBody { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
.dshmcp-dialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.dshmcp-dialogDanger { background: var(--dsw-alias-state-error-primary); }
.dshmcp-dialogDanger:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary); opacity: 0.9; }
@media (max-width: 640px) {
  .dshmcp-page { padding: 0 16px 32px; }
  .dshmcp-grid { grid-template-columns: 1fr; }
  .dshmcp-detailHead { gap: 10px; }
  .dshmcp-avatarLg { width: 44px; height: 44px; font-size: 18px; }
  .dshmcp-row { align-items: flex-start; flex-wrap: wrap; }
  .dshmcp-rowEnd { margin-left: auto; }
  .dshmcp-facts > div { align-items: flex-start; flex-direction: column; gap: 2px; }
  .dshmcp-facts dd { text-align: start; }
  .dshmcp-toasts { right: 12px; left: 12px; bottom: 12px; }
  .dshmcp-toast { max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dshmcp-busy,
  .dshmcp-skel,
  .dshmcp-spinner { animation: none; }
  .dshmcp-switch,
  .dshmcp-switch::after { transition: none; }
}
`

/** Small stroke icons. All are decorative; labels live on the controls. */
function Icon({ size = 16, viewBox = '0 0 24 24', children }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, children)
}

const SearchIcon = ({ size }) => Icon({ size, children: [
  h('circle', { key: 'c', cx: 11, cy: 11, r: 6.5 }),
  h('path', { key: 'l', d: 'm16 16 4.5 4.5' }),
] })

const CloseIcon = ({ size }) => Icon({ size, children: [
  h('path', { key: 'a', d: 'M6 6l12 12' }),
  h('path', { key: 'b', d: 'M18 6 6 18' }),
] })

const ChevronLeftIcon = ({ size }) => Icon({ size, children: h('path', { d: 'm14 6-6 6 6 6' }) })

const ChevronRightIcon = ({ size }) => Icon({ size, children: h('path', { d: 'm10 6 6 6-6 6' }) })

const ExternalLinkIcon = ({ size = 14 }) => Icon({ size, children: [
  h('path', { key: 'a', d: 'M14 4h6v6' }),
  h('path', { key: 'b', d: 'M20 4 11 13' }),
  h('path', { key: 'c', d: 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }),
] })

const WarningIcon = ({ size = 16 }) => Icon({ size, children: [
  h('path', { key: 'a', d: 'M12 4 21 20H3Z' }),
  h('path', { key: 'b', d: 'M12 10v4' }),
  h('path', { key: 'c', d: 'M12 17h.01' }),
] })

const CheckIcon = ({ size = 16 }) => Icon({ size, children: h('path', { d: 'm5 12 4.5 4.5L19 7' }) })

const AlertCircleIcon = ({ size = 20 }) => Icon({ size, children: [
  h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }),
  h('path', { key: 'a', d: 'M12 8v5' }),
  h('path', { key: 'b', d: 'M12 16h.01' }),
] })

const InboxIcon = ({ size = 20 }) => Icon({ size, children: [
  h('path', { key: 'a', d: 'M4 5h16v14H4z' }),
  h('path', { key: 'b', d: 'M4 13h4l2 3h4l2-3h4' }),
] })

const TrashIcon = ({ size = 15 }) => Icon({ size, children: [
  h('path', { key: 'a', d: 'M4 7h16' }),
  h('path', { key: 'b', d: 'M9 7V5h6v2' }),
  h('path', { key: 'c', d: 'M6 7l1 13h10l1-13' }),
] })

const LockIcon = ({ size = 13 }) => Icon({ size, children: [
  h('rect', { key: 'a', x: 5, y: 10, width: 14, height: 10, rx: 2 }),
  h('path', { key: 'b', d: 'M8 10V7a4 4 0 0 1 8 0v3' }),
] })

const PlugIcon = ({ size = 20 }) => Icon({ size, children: [
  h('path', { key: 'a', d: 'M9 3v5M15 3v5' }),
  h('path', { key: 'b', d: 'M6 8h12v3a6 6 0 0 1-12 0Z' }),
  h('path', { key: 'c', d: 'M12 17v4' }),
] })

/** Sidebar glyph: a node-link motif shared with the plugin icon. */
function McpMarketPanelIcon({ size = 18 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  h('circle', { cx: 6, cy: 12, r: 2.3 }),
  h('circle', { cx: 18, cy: 6, r: 2.3 }),
  h('circle', { cx: 18, cy: 18, r: 2.3 }),
  h('path', { d: 'M8.2 10.9l7.6-3.8' }),
  h('path', { d: 'M8.2 13.1l7.6 3.8' }))
}

/** Locale-aware error text with the stable code as a secondary line. */
function errorText(t, error) {
  const code = error?.code
  let key = ERROR_KEYS[code]
  if (code === 'mcp/fetch-failed' && error?.details?.reason === 'rate-limit') key = 'error.rateLimited'
  if (code === 'mcp/fetch-failed' && error?.details?.reason === 'timeout') key = 'error.timeout'
  let message = key === undefined ? t('error.unknown') : t(key)
  if (code === 'mcp/runtime-missing' && error?.details?.command !== undefined) {
    message = formatTemplate(message, { command: error.details.command })
  }
  return { message, code: typeof code === 'string' ? code : null }
}

/** Localized warning text for a Host warning code. */
function warningText(t, code) {
  const key = WARNING_KEYS[code]
  return key === undefined ? code : t(key)
}

/** Join missing-input details into localized lines. */
function missingLines(t, details) {
  const missing = Array.isArray(details?.missing) ? details.missing : []
  return missing.map(item => formatTemplate(
    item?.kind === 'url' ? t('detail.blockedUrl') : t('detail.blockedArgument'),
    { name: item?.name ?? '' },
  ))
}

/** Deterministic monogram avatar. */
function Avatar({ title, name, size = 'md' }) {
  const className = size === 'lg' ? 'dshmcp-avatar dshmcp-avatarLg' : size === 'sm' ? 'dshmcp-avatar dshmcp-avatarSm' : 'dshmcp-avatar'
  return h('span', {
    className,
    style: { '--dshmcp-hue': String(hueFor(`${name ?? ''}|${title ?? ''}`)) },
    'aria-hidden': 'true',
  }, monogram(title, name))
}

/** Small button used for standard actions. */
function Button({ children, variant = 'secondary', className = '', ...props }) {
  const variantClass = variant === 'primary'
    ? ' dshmcp-btnPrimary'
    : variant === 'danger' ? ' dshmcp-btnDanger' : ''
  return h('button', { type: 'button', className: `dshmcp-btn${variantClass}${className === '' ? '' : ` ${className}`}`, ...props }, children)
}

/** Badge with an optional tone. */
function Badge({ children, tone }) {
  const toneClass = tone === 'brand'
    ? ' dshmcp-badgeBrand'
    : tone === 'warn' ? ' dshmcp-badgeWarn' : tone === 'success' ? ' dshmcp-badgeSuccess' : ''
  return h('span', { className: `dshmcp-badge${toneClass}` }, children)
}

/** One-line notice with a tinted background. */
function Callout({ children, tone = 'default' }) {
  const toneClass = tone === 'warn'
    ? ' dshmcp-calloutWarn'
    : tone === 'error' ? ' dshmcp-calloutError' : tone === 'success' ? ' dshmcp-calloutSuccess' : ''
  const icon = tone === 'warn' || tone === 'error'
    ? h(WarningIcon, { size: 14 })
    : tone === 'success' ? h(CheckIcon, { size: 14 }) : h(AlertCircleIcon, { size: 14 })
  return h('div', { className: `dshmcp-callout${toneClass}` }, icon, h('div', { className: 'dshmcp-calloutBody' }, children))
}

/** Skeleton grid used while the first search loads. */
function SkeletonGrid() {
  return h('div', { className: 'dshmcp-grid', 'aria-hidden': 'true' },
    Array.from({ length: 6 }, (_, index) => h('div', { key: index, className: 'dshmcp-card dshmcp-cardSkel' },
      h('div', { className: 'dshmcp-cardHead' },
        h('span', { className: 'dshmcp-skel dshmcp-skelCircle' }),
        h('span', { className: 'dshmcp-skelLines' },
          h('span', { className: 'dshmcp-skel dshmcp-skelLine', style: { width: '55%' } }),
          h('span', { className: 'dshmcp-skel dshmcp-skelLine dshmcp-skelLineShort' }),
        ),
      ),
      h('span', { className: 'dshmcp-skel dshmcp-skelLine' }),
      h('span', { className: 'dshmcp-skel dshmcp-skelLine', style: { width: '70%' } }),
    )))
}

/** Skeleton rows for the installed view. */
function SkeletonRows() {
  return h('div', { 'aria-hidden': 'true' },
    Array.from({ length: 4 }, (_, index) => h('div', { key: index, className: 'dshmcp-skelRow' },
      h('span', { className: 'dshmcp-skel dshmcp-skelCircle' }),
      h('span', { className: 'dshmcp-skelLines' },
        h('span', { className: 'dshmcp-skel dshmcp-skelLine', style: { width: '38%' } }),
        h('span', { className: 'dshmcp-skel dshmcp-skelLine dshmcp-skelLineShort' }),
      ),
    )))
}

/** Error card with a retry control. */
function ErrorState({ t, error, onRetry }) {
  const text = errorText(t, error)
  return h('div', { className: 'dshmcp-state' },
    h('span', { className: 'dshmcp-stateIcon dshmcp-stateIconError' }, h(AlertCircleIcon, { size: 20 })),
    h('h2', { className: 'dshmcp-stateTitle' }, t('state.errorTitle')),
    h('p', { className: 'dshmcp-stateBody' }, text.message),
    text.code === null ? null : h('p', { className: 'dshmcp-stateCode' }, formatTemplate(t('state.errorCode'), { code: text.code })),
    h('div', { style: { marginTop: '8px' } },
      Button({ onClick: onRetry, children: t('action.retry') }),
    ),
  )
}

/** Empty card with an optional action. */
function EmptyState({ t, title, body, action }) {
  return h('div', { className: 'dshmcp-state' },
    h('span', { className: 'dshmcp-stateIcon' }, h(InboxIcon, { size: 20 })),
    h('h2', { className: 'dshmcp-stateTitle' }, title),
    h('p', { className: 'dshmcp-stateBody' }, body),
    action ?? null,
  )
}

/** Toast stack. */
function ToastViewport({ t, toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return h('div', { className: 'dshmcp-toasts', role: 'status', 'aria-live': 'polite' },
    toasts.map(toast => h('div', {
      key: toast.id,
      className: `dshmcp-toast ${toast.kind === 'error' ? 'dshmcp-toastError' : 'dshmcp-toastSuccess'}`,
    },
    toast.kind === 'error' ? h(AlertCircleIcon, { size: 15 }) : h(CheckIcon, { size: 15 }),
    h('span', { className: 'dshmcp-toastText' }, toast.message),
    h('button', {
      type: 'button',
      className: 'dshmcp-toastClose',
      'aria-label': t('toast.dismiss'),
      onClick: () => { onDismiss(toast.id) },
    }, h(CloseIcon, { size: 13 })),
    )))
}

/** Modal confirmation dialog with Esc and overlay dismissal. */
function ConfirmDialog({ t, request, busy, onCancel, onConfirm }) {
  const cancelRef = React.useRef(null)
  React.useEffect(() => {
    if (request === null || request === undefined) return undefined
    const onKey = event => {
      if (event.key === 'Escape' && busy !== true) onCancel()
    }
    document.addEventListener('keydown', onKey)
    const timer = setTimeout(() => { cancelRef.current?.focus() }, 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(timer)
    }
  }, [request, busy, onCancel])
  if (request === null || request === undefined) return null
  return h('div', {
    className: 'dshmcp-overlay',
    onMouseDown: event => {
      if (event.target === event.currentTarget && busy !== true) onCancel()
    },
  },
  h('div', {
    className: 'dshmcp-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'dshmcp-dialog-title',
    'aria-describedby': 'dshmcp-dialog-body',
  },
  h('h2', { className: 'dshmcp-dialogTitle', id: 'dshmcp-dialog-title' }, t('installed.removeTitle')),
  h('p', { className: 'dshmcp-dialogBody', id: 'dshmcp-dialog-body' },
    formatTemplate(t('installed.removeBody'), { name: request.title || request.serverName })),
  h('div', { className: 'dshmcp-dialogActions' },
    h('button', {
      type: 'button',
      className: 'dshmcp-btn',
      ref: cancelRef,
      disabled: busy === true,
      onClick: onCancel,
    }, t('action.cancel')),
    h('button', {
      type: 'button',
      className: 'dshmcp-btn dshmcp-btnPrimary dshmcp-dialogDanger',
      disabled: busy === true,
      onClick: onConfirm,
    }, busy === true ? t('action.installing') : t('action.remove')),
  )))
}

/** Search form and result grid for the Discover view. */
function DiscoverView({ t, state, searchInput, onInput, onSearchNow, onClear, onOpen, onRetry }) {
  const hasServers = state.servers.length > 0
  return h(React.Fragment, null,
    h('form', {
      className: 'dshmcp-search',
      role: 'search',
      onSubmit: event => {
        event.preventDefault()
        onSearchNow()
      },
    },
    h('div', { className: 'dshmcp-searchBox' },
      h('span', { className: 'dshmcp-searchIcon' }, h(SearchIcon, { size: 16 })),
      h('input', {
        className: 'dshmcp-searchInput',
        type: 'search',
        value: searchInput,
        placeholder: t('search.placeholder'),
        'aria-label': t('search.label'),
        autoComplete: 'off',
        spellCheck: false,
        onChange: event => { onInput(event.currentTarget.value) },
      }),
      searchInput.length === 0 ? null : h('button', {
        type: 'button',
        className: 'dshmcp-searchClear',
        'aria-label': t('search.clear'),
        onClick: onClear,
      }, h(CloseIcon, { size: 14 })),
    ),
    h('span', { className: 'dshmcp-tabCount', 'aria-hidden': 'true' },
      state.busy ? h('span', { className: 'dshmcp-spinner' }) : null),
    ),
    h('div', { className: 'dshmcp-srOnly', role: 'status', 'aria-live': 'polite' }, state.busy ? t('search.busy') : ''),
    h('div', { className: 'dshmcp-busy', 'data-on': state.busy ? 'true' : 'false', 'aria-hidden': 'true' }),
    h('div', { className: 'dshmcp-metaLine' },
      state.status === 'ready' && hasServers
        ? h('span', null, formatTemplate(t('search.results'), { count: state.servers.length }))
        : null,
      state.cached && hasServers ? h(Badge, { tone: 'brand' }, t('search.cached')) : null,
    ),
    state.error !== null && hasServers
      ? h('div', { style: { marginTop: '12px' } }, h(Callout, { tone: 'warn' }, errorText(t, state.error).message))
      : null,
    state.status === 'loading' && !hasServers ? SkeletonGrid()
      : state.status === 'error' && !hasServers ? ErrorState({ t, error: state.error, onRetry })
        : state.status === 'ready' && !hasServers
          ? EmptyState({
            t,
            title: t('state.discoverEmptyTitle'),
            body: t('state.discoverEmptyBody'),
          })
          : h('div', { className: 'dshmcp-grid' },
            state.servers.map(server => h(ServerCard, { key: server.name, t, server, onOpen }))),
  )
}

/** One catalog card. */
function ServerCard({ t, server, onOpen }) {
  const kinds = transportKinds(server)
  const date = formatDate(server.updatedAt)
  return h('button', {
    type: 'button',
    className: 'dshmcp-card',
    'aria-label': formatTemplate(t('card.open'), { name: server.title || server.name }),
    onClick: () => { onOpen(server) },
  },
  h('span', { className: 'dshmcp-cardHead' },
    h(Avatar, { title: server.title, name: server.name }),
    h('span', { className: 'dshmcp-cardTitles' },
      h('span', { className: 'dshmcp-cardTitle' }, server.title || server.name),
      h('span', { className: 'dshmcp-cardName' }, server.name),
    ),
  ),
  server.description.length === 0 ? null : h('span', { className: 'dshmcp-cardDesc' }, server.description),
  h('span', { className: 'dshmcp-cardFoot' },
    kinds.includes('remote') ? h(Badge, { tone: 'brand' }, t('card.remote')) : null,
    kinds.includes('package') ? h(Badge, null, t('card.package')) : null,
    kinds.length === 0 ? h(Badge, { tone: 'warn' }, t('card.notSupported')) : null,
    server.isLatest ? h(Badge, { tone: 'success' }, t('card.latest')) : null,
    date.length === 0 ? null : h('span', { className: 'dshmcp-cardDate' }, formatTemplate(t('card.updated'), { date })),
  ))
}

/** One field in the install form. */
function InstallField({ t, field, value, error, onChange }) {
  const [revealed, setRevealed] = React.useState(false)
  const labelId = `dshmcp-field-${field.kind}-${field.name}`
  const errorId = `${labelId}-error`
  const isEnv = field.kind === 'env'
  const secret = field.secret === true
  const label = h('label', { className: 'dshmcp-label', htmlFor: labelId },
    h('span', { className: 'dshmcp-labelCode' }, field.name),
    field.required ? h(Badge, { tone: 'brand' }, t('detail.required')) : h(Badge, null, t('detail.optional')),
    secret ? h(Badge, { tone: 'warn' }, t('detail.secret')) : null,
  )
  const describedBy = error === undefined ? undefined : errorId
  const common = {
    id: labelId,
    value,
    'aria-invalid': error === undefined ? undefined : 'true',
    'aria-describedby': describedBy,
    autoComplete: 'off',
    spellCheck: false,
    onChange: event => { onChange(event.currentTarget.value) },
  }
  return h('div', { className: 'dshmcp-field' },
    label,
    field.description.length === 0 ? null : h('p', { className: 'dshmcp-hint' }, field.description),
    isEnv
      ? h('textarea', {
        ...common,
        className: 'dshmcp-textarea',
        rows: 2,
        'data-secret': secret && !revealed ? 'true' : 'false',
      })
      : h('div', { className: 'dshmcp-inputRow' },
        h('input', {
          ...common,
          className: secret ? 'dshmcp-input dshmcp-inputWithReveal' : 'dshmcp-input',
          type: secret && !revealed ? 'password' : 'text',
        }),
        secret
          ? h('button', {
            type: 'button',
            className: 'dshmcp-reveal',
            onClick: () => { setRevealed(current => !current) },
          }, revealed ? t('action.hide') : t('action.show'))
          : null,
      ),
    field.hasDefault ? h('p', { className: 'dshmcp-hint' }, t('detail.defaultValue')) : null,
    error === undefined ? null : h('p', { className: 'dshmcp-fieldError', id: errorId }, formatTemplate(
      t(`field.${error}`),
      { label: field.name },
    )),
  )
}

/** Install form with choice radio, secret/env fields, validation, and result. */
function InstallPanel({ t, registryName, previewState, onRetry, onSubmit, onClose, onViewInstalled }) {
  const preview = previewState.preview
  const [choiceKey, setChoiceKey] = React.useState('')
  const [values, setValues] = React.useState({ headers: {}, env: {} })
  const [errors, setErrors] = React.useState({})
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState(null)
  const [result, setResult] = React.useState(null)

  React.useEffect(() => {
    setChoiceKey(defaultChoiceKey(preview))
    setValues({ headers: {}, env: {} })
    setErrors({})
    setSubmitError(null)
    setResult(null)
  }, [preview])

  if (previewState.status === 'loading') {
    return h('div', { className: 'dshmcp-panel' },
      h('div', { className: 'dshmcp-skelRow' },
        h('span', { className: 'dshmcp-skel dshmcp-skelCircle' }),
        h('span', { className: 'dshmcp-skelLines' },
          h('span', { className: 'dshmcp-skel dshmcp-skelLine', style: { width: '40%' } }),
          h('span', { className: 'dshmcp-skel dshmcp-skelLine dshmcp-skelLineShort' }),
        ),
      ),
    )
  }
  if (previewState.status === 'error') {
    return h('div', { className: 'dshmcp-panel' },
      h('h2', { className: 'dshmcp-panelTitle' }, t('detail.installTitle')),
      ErrorState({ t, error: previewState.error, onRetry }),
    )
  }
  if (preview === null || preview === undefined) return null

  if (result !== null) {
    return h('div', { className: 'dshmcp-panel' },
      h('h2', { className: 'dshmcp-panelTitle' }, t('detail.installSuccess')),
      h(Callout, { tone: 'success' }, result.applied ? t('detail.installApplied') : t('detail.installRestart')),
      h('p', { className: 'dshmcp-hint' }, t('detail.installNoTools')),
      h('div', { className: 'dshmcp-actions' },
        Button({ variant: 'primary', onClick: onViewInstalled, children: t('action.viewInstalled') }),
        Button({ onClick: onClose, children: t('action.done') }),
      ),
    )
  }

  const previewChoices = Array.isArray(preview.choices) ? preview.choices : []
  const choice = choiceAt(preview, choiceKey)
  const headerFieldsForChoice = (choice?.headers ?? []).map(field => ({ ...field, kind: 'header' }))
  const envFieldsForChoice = (choice?.env ?? []).map(field => ({ ...field, kind: 'env' }))
  const fields = [...headerFieldsForChoice, ...envFieldsForChoice]
  const warnings = [...new Set([...(choice?.warnings ?? preview.warnings ?? [])])]
    .filter(code => code !== 'runtime-missing' && code !== 'unsupported')
  const blocked = choice?.blocked ?? preview.blocked ?? []
  const existing = preview.existing === true
  const unavailable = preview.kind === null || choice === null
  const runtimeMissing = choice !== null && choice.available === false

  const setValue = (kind, name, value) => {
    const group = kind === 'header' ? 'headers' : 'env'
    setValues(current => ({ ...current, [group]: { ...current[group], [name]: value } }))
    setErrors(current => {
      if (current[name] === undefined) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  const submit = async () => {
    if (choice === null || submitting || runtimeMissing) return
    const headerErrors = validateFields(headerFieldsForChoice, values.headers)
    const envErrors = validateFields(envFieldsForChoice, values.env)
    const nextErrors = { ...headerErrors, ...envErrors }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const installed = await onSubmit({
        registryName,
        choice: { kind: choice.kind, index: choice.index },
        values: {
          headers: values.headers,
          env: values.env,
        },
        replace: existing,
      })
      setResult(installed)
    } catch (error) {
      setSubmitError(error)
    } finally {
      setSubmitting(false)
    }
  }

  return h('div', { className: 'dshmcp-panel' },
    h('div', { className: 'dshmcp-panelHead' },
      h('div', null,
        h('h2', { className: 'dshmcp-panelTitle' }, t('detail.installTitle')),
        h('p', { className: 'dshmcp-panelHint' }, t('detail.installHint')),
      ),
      h('button', {
        type: 'button',
        className: 'dshmcp-iconBtn',
        'aria-label': t('action.close'),
        onClick: onClose,
      }, h(CloseIcon, { size: 15 })),
    ),
    existing ? h(Callout, { tone: 'warn' }, h('span', null,
      h('strong', null, t('detail.existing')),
      h('br'),
      h('span', null, t('detail.existingHint')),
    )) : null,
    warnings.length === 0 ? null : h('div', { className: 'dshmcp-fields' },
      warnings.map(code => h('p', { key: code, className: 'dshmcp-hint' }, warningText(t, code)))),
    unavailable
      ? h(Callout, { tone: 'warn' }, t('detail.notInstallable'))
      : h(React.Fragment, null,
        h('div', { className: 'dshmcp-fields' },
          h('div', { className: 'dshmcp-label' }, t('detail.choice')),
          previewChoices.length <= 1 ? null : h('div', { className: 'dshmcp-choiceList', role: 'radiogroup', 'aria-label': t('detail.choice') },
            previewChoices.map(candidate => {
              const key = `${candidate.kind}:${candidate.index}`
              const detail = candidate.kind === 'remote'
                ? `${t('detail.choiceRemote')} · ${candidate.url ?? ''}`
                : `${t('detail.choicePackage')} · ${candidate.command ?? ''} ${candidate.identifier ?? ''}`
              return h('label', {
                key,
                className: 'dshmcp-choice',
                'data-active': key === choiceKey ? 'true' : 'false',
                'data-disabled': candidate.available === false ? 'true' : 'false',
              },
              h('input', {
                type: 'radio',
                name: 'dshmcp-choice',
                value: key,
                checked: key === choiceKey,
                disabled: candidate.available === false,
                onChange: () => { setChoiceKey(key); setErrors({}) },
              }),
              h('span', { className: 'dshmcp-choiceMain' },
                h('span', { className: 'dshmcp-choiceTitle' }, candidate.kind === 'remote' ? t('detail.choiceRemote') : t('detail.choicePackage')),
                h('span', { className: 'dshmcp-choiceDetail' }, detail),
                candidate.available === false
                  ? h('span', { className: 'dshmcp-hint' }, formatTemplate(t('detail.runtimeMissing'), { command: candidate.command ?? '' }))
                  : null,
              ),
              )
            }),
          ),
          runtimeMissing ? h(Callout, { tone: 'warn' }, formatTemplate(t('detail.runtimeMissing'), { command: choice.command ?? '' })) : null,
          blocked.length === 0 ? null : h(Callout, { tone: 'warn' }, h('span', null,
            h('strong', null, t('detail.blockedTitle')),
            blocked.map(item => h('div', { key: `${item.kind}:${item.name}` },
              formatTemplate(item.kind === 'url' ? t('detail.blockedUrl') : t('detail.blockedArgument'), { name: item.name }))),
          )),
          fields.length === 0 ? null : h('div', { className: 'dshmcp-fields' },
            headerFieldsForChoice.length === 0 ? null : h('div', { className: 'dshmcp-label' }, t('detail.headers')),
            headerFieldsForChoice.map(field => h(InstallField, {
              key: `header:${field.name}`,
              t,
              field,
              value: values.headers[field.name] ?? '',
              error: errors[field.name],
              onChange: value => { setValue('header', field.name, value) },
            })),
            envFieldsForChoice.length === 0 ? null : h('div', { className: 'dshmcp-label' }, t('detail.env')),
            envFieldsForChoice.map(field => h(InstallField, {
              key: `env:${field.name}`,
              t,
              field,
              value: values.env[field.name] ?? '',
              error: errors[field.name],
              onChange: value => { setValue('env', field.name, value) },
            })),
          ),
        ),
        choice?.config === null || choice?.config === undefined ? null : h('div', { className: 'dshmcp-section' },
          h('div', { className: 'dshmcp-label' }, t('detail.configPreview')),
          h('pre', { className: 'dshmcp-code' }, JSON.stringify(choice.config, null, 2)),
        ),
        submitError === null ? null : h(Callout, { tone: 'error' }, h('span', null,
          h('strong', null, t('detail.installFailed')),
          h('br'),
          h('span', null, errorText(t, submitError).message),
          missingLines(t, submitError?.details).map((line, index) => h('div', { key: `${index}:${line}` }, line)),
        )),
        h('div', { className: 'dshmcp-actions' },
          Button({
            variant: 'primary',
            disabled: submitting || unavailable || runtimeMissing || blocked.length > 0,
            onClick: submit,
            children: submitting
              ? (existing ? t('action.replacing') : t('action.installing'))
              : (existing ? t('action.replace') : t('action.install')),
          }),
          Button({ onClick: onClose, disabled: submitting, children: t('action.cancel') }),
        ),
      ),
  )
}

/** Detail page for one server. */
function DetailView({ t, state, onBack, onRetry, onInstall, installState, installProps }) {
  if (state.status === 'loading' && state.server === null) {
    return h('div', { className: 'dshmcp-detail' },
      h('button', { type: 'button', className: 'dshmcp-back', onClick: onBack }, h(ChevronLeftIcon, { size: 15 }), t('action.back')),
      SkeletonRows(),
    )
  }
  if (state.server === null) {
    return h('div', { className: 'dshmcp-detail' },
      h('button', { type: 'button', className: 'dshmcp-back', onClick: onBack }, h(ChevronLeftIcon, { size: 15 }), t('action.back')),
      ErrorState({ t, error: state.error, onRetry }),
    )
  }
  const server = state.server
  const kinds = transportKinds(server)
  const remoteCount = server.remotes.length
  const stdioCount = server.packages.filter(pkg => pkg?.transport?.type === 'stdio').length
  const date = formatDate(server.updatedAt)
  return h('div', { className: 'dshmcp-detail' },
    h('button', { type: 'button', className: 'dshmcp-back', onClick: onBack }, h(ChevronLeftIcon, { size: 15 }), t('action.back')),
    state.error === null ? null : h(Callout, { tone: 'warn' }, errorText(t, state.error).message),
    h('div', { className: 'dshmcp-detailHead' },
      h(Avatar, { title: server.title, name: server.name, size: 'lg' }),
      h('div', { className: 'dshmcp-detailTitles' },
        h('h1', { className: 'dshmcp-detailTitle' }, server.title || server.name),
        h('div', { className: 'dshmcp-detailName' }, server.name),
        h('div', { className: 'dshmcp-detailBadges' },
          server.version.length === 0 ? null : h(Badge, { tone: 'brand' }, `v${server.version}`),
          kinds.includes('remote') ? h(Badge, null, t('detail.remote')) : null,
          kinds.includes('package') ? h(Badge, null, t('detail.package')) : null,
          kinds.length === 0 ? h(Badge, { tone: 'warn' }, t('card.notSupported')) : null,
        ),
      ),
    ),
    server.description.length === 0 ? null : h('p', { className: 'dshmcp-desc' }, server.description),
    h('dl', { className: 'dshmcp-facts' },
      h('div', null,
        h('dt', null, t('detail.version')),
        h('dd', null, server.version.length === 0 ? '—' : server.version),
      ),
      h('div', null,
        h('dt', null, t('detail.updated')),
        h('dd', null, date.length === 0 ? '—' : date),
      ),
      h('div', null,
        h('dt', null, t('detail.connection')),
        h('dd', null, [
          remoteCount > 0 ? `${remoteCount} × ${t('detail.remote')}` : null,
          stdioCount > 0 ? `${stdioCount} × ${t('detail.package')}` : null,
        ].filter(Boolean).join(' · ') || '—'),
      ),
      server.repository === null ? null : h('div', null,
        h('dt', null, t('detail.repository')),
        h('dd', null, h('a', {
          className: 'dshmcp-link',
          href: server.repository,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, server.repository, h(ExternalLinkIcon, { size: 12 }))),
      ),
      server.websiteUrl === null ? null : h('div', null,
        h('dt', null, t('detail.website')),
        h('dd', null, h('a', {
          className: 'dshmcp-link',
          href: server.websiteUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, server.websiteUrl, h(ExternalLinkIcon, { size: 12 }))),
      ),
    ),
    h('div', { className: 'dshmcp-trust' }, h(WarningIcon, { size: 14 }), h('span', null, t('detail.trust'))),
    installState.open ? installProps.panel : h('div', { className: 'dshmcp-section' },
      h('div', { className: 'dshmcp-actions' },
        Button({ variant: 'primary', onClick: onInstall, children: t('action.install') }),
      ),
    ),
  )
}

/** One managed or external row in the Installed view. */
function InstalledRow({ t, row, busy, onToggle, onRemove, external }) {
  const kind = row.transport === 'streamable-http' ? t('card.remote') : t('card.package')
  const installedAt = formatDate(row.installedAt)
  const toolLabel = row.toolCount > 0 ? formatTemplate(t('installed.tools'), { count: row.toolCount }) : t('installed.noTools')
  return h('li', { className: 'dshmcp-row', 'data-enabled': row.enabled ? 'true' : 'false' },
    h(Avatar, { title: row.title, name: row.serverName, size: 'sm' }),
    h('div', { className: 'dshmcp-rowMain' },
      h('div', { className: 'dshmcp-rowTitleRow' },
        h('span', { className: 'dshmcp-rowTitle' }, row.title || row.serverName),
        external ? h(Badge, { tone: 'warn' }, h(LockIcon, { size: 11 }), t('installed.externalBadge')) : null,
        row.enabled ? null : h(Badge, null, t('installed.disabled')),
      ),
      h('div', { className: 'dshmcp-rowMeta' },
        h('code', null, row.serverName),
        h('span', null, kind),
        external ? null : h('span', null, formatTemplate(t('installed.versionLabel'), { version: row.version || '—' })),
        external ? null : h('span', null, toolLabel),
        installedAt.length === 0 ? null : h('span', null, formatTemplate(t('installed.installedAt'), { date: installedAt })),
      ),
    ),
    h('div', { className: 'dshmcp-rowEnd' },
      external
        ? h(Badge, { tone: 'brand' }, row.enabled ? t('installed.enabled') : t('installed.disabled'))
        : h(React.Fragment, null,
          h('button', {
            type: 'button',
            className: 'dshmcp-switch',
            role: 'switch',
            'aria-checked': row.enabled ? 'true' : 'false',
            'aria-label': `${row.enabled ? t('installed.disable') : t('installed.enable')} ${row.title || row.serverName}`,
            'data-on': row.enabled ? 'true' : 'false',
            disabled: busy,
            onClick: () => { onToggle(row) },
          }),
          Button({
            variant: 'danger',
            disabled: busy,
            'aria-label': `${t('action.remove')} ${row.title || row.serverName}`,
            onClick: () => { onRemove(row) },
            children: [h(TrashIcon, { key: 'icon', size: 14 }), h('span', { key: 'label' }, t('action.remove'))],
          }),
        ),
    ),
  )
}

/** Installed list with managed and external sections. */
function InstalledView({ t, state, lastFeedback, busyRow, onRetry, onRefresh, onToggle, onRemove, onDiscover }) {
  if (state.status === 'loading' && state.data === null) {
    return h('div', { className: 'dshmcp-installed' }, SkeletonRows())
  }
  if (state.data === null && state.error !== null) {
    return h('div', { className: 'dshmcp-installed' }, ErrorState({ t, error: state.error, onRetry }))
  }
  const data = state.data
  if (data === null) return null
  const count = data.servers.length + data.external.length
  return h('div', { className: 'dshmcp-installed' },
    h('div', { className: 'dshmcp-infoBar' },
      h('span', null, `${t('installed.profile')}: `, h('code', null, data.profileName ?? '—')),
      h('span', null, `${t('installed.patch')}: `, h('code', null, data.patchPath ?? t('installed.patchMissing'))),
      h(Badge, { tone: data.hmr ? 'success' : 'warn' }, data.hmr ? t('installed.hmrOn') : t('installed.hmrOff')),
    ),
    data.patchPath === null ? h(Callout, { tone: 'warn' }, t('installed.noPatch')) : null,
    data.hmr ? null : h(Callout, { tone: 'warn' }, t('installed.hmrHint')),
    lastFeedback === null ? null : h(Callout, { tone: lastFeedback.restartRequired ? 'warn' : 'success' },
      lastFeedback.restartRequired ? t('toast.restartRequired') : t('toast.applied')),
    state.error === null ? null : h(Callout, { tone: 'warn' }, errorText(t, state.error).message),
    count === 0
      ? EmptyState({
        t,
        title: t('state.installedEmptyTitle'),
        body: t('state.installedEmptyBody'),
        action: h('div', { style: { marginTop: '8px' } },
          Button({ variant: 'primary', onClick: onDiscover, children: t('tab.discover') })),
      })
      : h(React.Fragment, null,
        h('div', { className: 'dshmcp-section' },
          h('div', { className: 'dshmcp-sectionHead' },
            h('h2', { className: 'dshmcp-sectionTitle' }, t('installed.managed')),
            Button({ onClick: onRefresh, disabled: state.busy, 'aria-label': t('action.refresh'), children: t('action.refresh') }),
          ),
          data.servers.length === 0
            ? h('p', { className: 'dshmcp-hint' }, t('state.installedEmptyBody'))
            : h('ul', { className: 'dshmcp-list' },
              data.servers.map(row => h(InstalledRow, {
                key: row.rowId,
                t,
                row,
                external: false,
                busy: busyRow === row.rowId,
                onToggle,
                onRemove,
              }))),
        ),
        data.external.length === 0 ? null : h('div', { className: 'dshmcp-section' },
          h('div', { className: 'dshmcp-sectionHead' },
            h('h2', { className: 'dshmcp-sectionTitle' }, t('installed.external')),
          ),
          h('p', { className: 'dshmcp-hint' }, t('installed.externalHint')),
          h('ul', { className: 'dshmcp-list' },
            data.external.map(row => h(InstalledRow, {
              key: row.rowId,
              t,
              row: { ...row, title: row.serverName, toolCount: 0, version: '', installedAt: '' },
              external: true,
              busy: false,
              onToggle: () => {},
              onRemove: () => {},
            }))),
        ),
      ),
  )
}

/** Toast state with auto-dismiss timers. */
function useToasts() {
  const [toasts, setToasts] = React.useState([])
  const timers = React.useRef(new Map())
  const dismiss = React.useCallback(id => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])
  const push = React.useCallback((kind, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts(current => [...current, { id, kind, message }])
    const timer = setTimeout(() => { dismiss(id) }, 5000)
    timers.current.set(id, timer)
  }, [dismiss])
  React.useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])
  return { toasts, push, dismiss }
}

/**
 * Build the page component with a fallback translator captured from the entry.
 * The slot normally passes `t`; the fallback keeps the page renderable if a
 * host version does not.
 */
function createMcpMarketPage(boundT) {
  function McpMarketPage(props) {
    const t = typeof props?.t === 'function' ? props.t : boundT
    const { toasts, push, dismiss } = useToasts()
    const [view, setView] = React.useState('discover')
    const [searchInput, setSearchInput] = React.useState('')
    const [query, setQuery] = React.useState('')
    const [searchState, setSearchState] = React.useState({ status: 'loading', servers: [], cached: false, busy: true, error: null })
    const [installedState, setInstalledState] = React.useState({ status: 'loading', data: null, busy: false, error: null })
    const [detailState, setDetailState] = React.useState({ status: 'idle', server: null, error: null })
    const [installState, setInstallState] = React.useState({ open: false, status: 'idle', preview: null, error: null })
    const [lastFeedback, setLastFeedback] = React.useState(null)
    const [busyRow, setBusyRow] = React.useState(null)
    const [confirmRow, setConfirmRow] = React.useState(null)
    const searchSequence = React.useRef(0)
    const detailSequence = React.useRef(0)
    const installedSequence = React.useRef(0)

    const runSearch = React.useCallback(async value => {
      const normalized = String(value ?? '').trim()
      const sequence = ++searchSequence.current
      setQuery(normalized)
      setSearchState(current => ({
        ...current,
        busy: true,
        cached: false,
        status: current.servers.length > 0 ? 'ready' : 'loading',
        error: null,
      }))
      try {
        const data = await requestJson(`/search?q=${encodeURIComponent(normalized)}`, { timeoutMs: TIMEOUTS.search })
        if (sequence !== searchSequence.current) return
        setSearchState({
          status: 'ready',
          servers: Array.isArray(data?.servers) ? data.servers : [],
          cached: data?.cached === true,
          busy: false,
          error: null,
        })
      } catch (error) {
        if (sequence !== searchSequence.current) return
        setSearchState(current => ({
          ...current,
          status: current.servers.length > 0 ? 'ready' : 'error',
          busy: false,
          error,
        }))
      }
    }, [])

    const loadInstalled = React.useCallback(async () => {
      const sequence = ++installedSequence.current
      setInstalledState(current => ({ ...current, status: current.data === null ? 'loading' : 'ready', busy: true, error: null }))
      try {
        const data = await requestJson('/installed', { timeoutMs: TIMEOUTS.mutation })
        if (sequence !== installedSequence.current) return
        setInstalledState({ status: 'ready', data, busy: false, error: null })
      } catch (error) {
        if (sequence !== installedSequence.current) return
        setInstalledState(current => ({
          ...current,
          status: current.data === null ? 'error' : 'ready',
          busy: false,
          error,
        }))
      }
    }, [])

    React.useEffect(() => {
      void runSearch('')
    }, [runSearch])

    React.useEffect(() => {
      void loadInstalled()
    }, [loadInstalled])

    React.useEffect(() => {
      if (view !== 'installed') return
      void loadInstalled()
    }, [view, loadInstalled])

    React.useEffect(() => {
      const normalized = searchInput.trim()
      if (normalized === query) return undefined
      const timer = setTimeout(() => { void runSearch(normalized) }, SEARCH_DEBOUNCE_MS)
      return () => { clearTimeout(timer) }
    }, [searchInput, query, runSearch])

    const openDetail = React.useCallback(async server => {
      setView('detail')
      setInstallState({ open: false, status: 'idle', preview: null, error: null })
      const sequence = ++detailSequence.current
      setDetailState({ status: 'ready', server, error: null })
      try {
        const data = await requestJson(`/detail?name=${encodeURIComponent(server.name)}`, { timeoutMs: TIMEOUTS.detail })
        if (sequence !== detailSequence.current) return
        setDetailState({ status: 'ready', server: data, error: null })
      } catch (error) {
        if (sequence !== detailSequence.current) return
        setDetailState({ status: 'ready', server, error })
      }
    }, [])

    const backToDiscover = React.useCallback(() => {
      detailSequence.current += 1
      setView('discover')
      setInstallState({ open: false, status: 'idle', preview: null, error: null })
    }, [])

    const retryDetail = React.useCallback(() => {
      if (detailState.server !== null) void openDetail(detailState.server)
    }, [detailState.server, openDetail])

    const loadPreview = React.useCallback(async server => {
      if (server === null || server === undefined) return
      setInstallState({ open: true, status: 'loading', preview: null, error: null })
      try {
        const preview = await requestJson('/preview', {
          method: 'POST',
          body: { registryName: server.name },
          timeoutMs: TIMEOUTS.preview,
        })
        setInstallState({ open: true, status: 'ready', preview, error: null })
      } catch (error) {
        setInstallState({ open: true, status: 'error', preview: null, error })
      }
    }, [])

    const openInstall = React.useCallback(() => {
      if (detailState.server === null) return
      if (installState.open) {
        setInstallState(current => ({ ...current, open: false }))
        return
      }
      void loadPreview(detailState.server)
    }, [detailState.server, installState.open, loadPreview])

    const submitInstall = React.useCallback(async body => {
      const result = await requestJson('/install', {
        method: 'POST',
        body,
        timeoutMs: TIMEOUTS.mutation,
      })
      setLastFeedback(result)
      const name = detailState.server?.title || detailState.server?.name || body.registryName
      push('success', formatTemplate(body.replace ? t('toast.replaced') : t('toast.installed'), { name }))
      await loadInstalled()
      return result
    }, [detailState.server, loadInstalled, push, t])

    const toggleRow = React.useCallback(async row => {
      setBusyRow(row.rowId)
      try {
        const result = await requestJson('/toggle', {
          method: 'POST',
          body: { rowId: row.rowId, enabled: !row.enabled },
          timeoutMs: TIMEOUTS.mutation,
        })
        setLastFeedback(result)
        push('success', result.applied ? t('toast.applied') : t('toast.restartRequired'))
        await loadInstalled()
      } catch (error) {
        push('error', formatTemplate(t('toast.error'), { message: errorText(t, error).message }))
      } finally {
        setBusyRow(null)
      }
    }, [loadInstalled, push, t])

    const removeRow = React.useCallback(async () => {
      const row = confirmRow
      if (row === null) return
      setBusyRow(row.rowId)
      try {
        const result = await requestJson('/remove', {
          method: 'POST',
          body: { rowId: row.rowId },
          timeoutMs: TIMEOUTS.mutation,
        })
        setLastFeedback(result)
        push('success', formatTemplate(t('toast.removed'), { name: row.title || row.serverName }))
        setConfirmRow(null)
        await loadInstalled()
      } catch (error) {
        push('error', formatTemplate(t('toast.error'), { message: errorText(t, error).message }))
      } finally {
        setBusyRow(null)
      }
    }, [confirmRow, loadInstalled, push, t])

    const installedCount = installedState.data === null
      ? 0
      : installedState.data.servers.length + installedState.data.external.length
    const selectedTab = view === 'installed' ? 'installed' : 'discover'

    const installPanel = h(InstallPanel, {
      t,
      registryName: detailState.server?.name ?? '',
      previewState: installState,
      onRetry: () => { void loadPreview(detailState.server) },
      onSubmit: submitInstall,
      onClose: () => { setInstallState(current => ({ ...current, open: false })) },
      onViewInstalled: () => {
        setInstallState(current => ({ ...current, open: false }))
        setView('installed')
      },
    })

    return h('div', { className: 'dshmcp-page' },
      h('div', { className: 'dshmcp-inner' },
        h('header', { className: 'dshmcp-head' },
          h('h1', { className: 'dshmcp-title' }, t('title')),
          h('p', { className: 'dshmcp-intro' }, t('intro')),
        ),
        h('div', { className: 'dshmcp-tabs', role: 'tablist', 'aria-label': t('title') },
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'dshmcp-tab',
            'aria-selected': selectedTab === 'discover' ? 'true' : 'false',
            onClick: () => {
              if (view === 'detail') backToDiscover()
              else setView('discover')
            },
          }, t('tab.discover')),
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'dshmcp-tab',
            'aria-selected': selectedTab === 'installed' ? 'true' : 'false',
            onClick: () => { setView('installed') },
          }, t('tab.installed'), installedCount > 0 ? h('span', { className: 'dshmcp-tabCount' }, installedCount) : null),
        ),
        view === 'installed'
          ? h(InstalledView, {
            t,
            state: installedState,
            lastFeedback,
            busyRow,
            onRetry: () => { void loadInstalled() },
            onRefresh: () => { void loadInstalled() },
            onToggle: row => { void toggleRow(row) },
            onRemove: row => { setConfirmRow(row) },
            onDiscover: () => { setView('discover') },
          })
          : view === 'detail'
            ? h(DetailView, {
              t,
              state: detailState,
              onBack: backToDiscover,
              onRetry: retryDetail,
              onInstall: () => { void openInstall() },
              installState,
              installProps: { panel: installPanel },
            })
            : h(DiscoverView, {
              t,
              state: searchState,
              searchInput,
              onInput: setSearchInput,
              onSearchNow: () => { void runSearch(searchInput) },
              onClear: () => {
                setSearchInput('')
                void runSearch('')
              },
              onOpen: server => { void openDetail(server) },
              onRetry: () => { void runSearch(query) },
            }),
      ),
      h(ToastViewport, { t, toasts, onDismiss: dismiss }),
      h(ConfirmDialog, {
        t,
        request: confirmRow,
        busy: confirmRow !== null && busyRow === confirmRow.rowId,
        onCancel: () => { setConfirmRow(null) },
        onConfirm: () => { void removeRow() },
      }),
    )
  }
  McpMarketPage.displayName = 'McpMarketPage'
  return McpMarketPage
}
