/**
 * Browser UI for the skills market.
 *
 * Two views share one page shell: Discover searches skills.sh through the Host
 * and opens a detail page, Installed lists everything under `~/.dsh/skills`.
 * Installing always goes through a preview dialog; warnings and replacements
 * need a second confirm click. No JSX and no external dependencies.
 */

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'skills-market'

/** Locale namespace owned by this plugin. */
const MARKET_NS = 'skillsMarket'

/** HTTP/API codes mapped to dictionary keys; server messages are never shown. */
const ERROR_KEYS = Object.freeze({
  'skills/invalid-query': 'errorInvalidQuery',
  'skills/fetch-failed': 'errorFetch',
  'skills/not-found': 'errorNotFound',
  'skills/invalid-skill': 'errorInvalidSkill',
  'skills/too-large': 'errorTooLarge',
  'skills/exists': 'errorExists',
  'skills/not-managed': 'errorNotManaged',
  'skills/staging-expired': 'errorStagingExpired',
  'skills/install-failed': 'errorInstall',
  'sources/invalid': 'errorSourceInvalid',
  'sources/limit': 'errorSourceLimit',
  'sources/not-found': 'errorSourceNotFound',
  'sources/builtin': 'errorSourceBuiltin',
  'sources/fetch-failed': 'errorSourceFetch',
  'sources/invalid-index': 'errorSourceInvalidIndex',
  timeout: 'errorTimeout',
  network: 'errorFetch',
})

/** Page styles, injected once by the entry and removed on dispose. */
const MARKET_CSS = `
.dshsm-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 0 clamp(24px, 4vw, 48px) 48px;
  overflow: auto;
  color: var(--dsw-alias-label-primary);
}
.dshsm-page > .dshsm-head,
.dshsm-page > .dshsm-toolbar,
.dshsm-page > .dshsm-progress,
.dshsm-page > .dshsm-warnBanner,
.dshsm-page > .dshsm-resultsHead,
.dshsm-page > .dshsm-trust,
.dshsm-page > .dshsm-grid,
.dshsm-page > .dshsm-state,
.dshsm-page > .dshsm-detail,
.dshsm-page > .dshsm-installed {
  width: 100%;
  max-width: 1040px;
}
.dshsm-head {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-top: 28px;
}
html[data-platform='darwin'] .dshsm-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.dshsm-heading { min-width: 0; max-width: 100%; }
.dshsm-title {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dshsm-intro {
  margin: 4px 0 0;
  max-width: 640px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dshsm-tabs {
  display: inline-flex;
  flex: none;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshsm-tab {
  box-sizing: border-box;
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
@media (hover: hover) {
  .dshsm-tab:hover { color: var(--dsw-alias-label-primary); }
}
.dshsm-tab[aria-selected='true'] {
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dshsm-toolbar { display: flex; align-items: center; gap: 12px; }
.dshsm-sourcePick { flex: none; min-width: 0; }
.dshsm-sourceSelect {
  box-sizing: border-box;
  max-width: 220px;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dshsm-sourceSelect:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dshsm-sourceSelect:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
@media (max-width: 720px) {
  .dshsm-toolbar { flex-wrap: wrap; }
  .dshsm-sourceSelect { max-width: 100%; width: 100%; }
  .dshsm-sourcePick { width: 100%; }
}
.dshsm-marketPicker { display: inline-flex; flex: none; min-width: 0; max-width: 220px; }
.dshsm-marketSelect {
  box-sizing: border-box;
  max-width: 220px;
  height: 40px;
  padding: 0 30px 0 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  cursor: pointer;
}
.dshsm-marketSelect:disabled { opacity: 0.65; cursor: default; }
.dshsm-search {
  box-sizing: border-box;
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 40px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  cursor: text;
}
.dshsm-search:focus-within {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-brand-primary);
}
.dshsm-searchIcon {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.dshsm-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
}
.dshsm-search input::placeholder { color: var(--dsw-alias-label-caption); }
.dshsm-search input::-webkit-search-cancel-button { display: none; }
.dshsm-searchClear {
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
@media (hover: hover) {
  .dshsm-searchClear:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-secondary);
  }
}
.dshsm-progress {
  position: relative;
  flex: none;
  height: 2px;
  margin-top: -8px;
  overflow: hidden;
  border-radius: 2px;
  background: transparent;
}
.dshsm-progress[data-active='true'] { background: var(--dsw-alias-border-l2); }
.dshsm-progress[data-active='true']::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 32%;
  border-radius: 2px;
  background: var(--dsw-alias-brand-primary);
  animation: dshsm-progress 1.15s cubic-bezier(0.36, 0, 0.64, 1) infinite;
}
@keyframes dshsm-progress {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(340%); }
}
.dshsm-warnBanner {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 34%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 18px;
}
.dshsm-warnBannerIcon { display: inline-flex; flex: none; color: var(--dsw-alias-state-warn-primary); }
.dshsm-warnBannerText { flex: 1; min-width: 0; }
.dshsm-resultsHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
}
.dshsm-resultsLabel {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}
.dshsm-resultsSource { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dshsm-resultsSep { margin: 0 6px; color: var(--dsw-alias-label-caption); }
.dshsm-resultsHint {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
}
.dshsm-trust {
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 18px;
}
.dshsm-trustCompact { background: transparent; }
.dshsm-trustIcon { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary); }
.dshsm-trustBody { min-width: 0; }
.dshsm-trustTitle { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dshsm-trustText { color: var(--dsw-alias-label-tertiary); }
.dshsm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.dshsm-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .dshsm-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshsm-cardHead { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.dshsm-cardTitleWrap { flex: 1; min-width: 0; }
.dshsm-cardTitle {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshsm-cardSource {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshsm-cardDesc {
  display: -webkit-box;
  min-height: 36px;
  margin: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12.5px;
  line-height: 18px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.dshsm-cardDescSkeleton { display: block; width: 100%; height: 12px; margin-top: 4px; }
.dshsm-cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
}
.dshsm-cardInstalls {
  color: var(--dsw-alias-label-caption);
  font-size: 11.5px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.dshsm-cardArrow {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-caption);
}
.dshsm-avatar {
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: color-mix(in srgb, hsl(var(--dshsm-hue) 72% 55%) 17%, var(--dsw-alias-bg-layer-2));
  color: hsl(var(--dshsm-hue) 58% 36%);
  font-size: 16px;
  line-height: 1;
  font-weight: 600;
  text-transform: uppercase;
  user-select: none;
}
body[data-ds-dark-theme] .dshsm-avatar {
  background: color-mix(in srgb, hsl(var(--dshsm-hue) 70% 60%) 22%, var(--dsw-alias-bg-layer-2));
  color: hsl(var(--dshsm-hue) 72% 74%);
}
.dshsm-avatarLg { width: 52px; height: 52px; border-radius: 13px; font-size: 21px; }
.dshsm-skeleton {
  display: block;
  border-radius: 6px;
  background: var(--dsw-alias-bg-skeleton);
  animation: dshsm-pulse 2s cubic-bezier(0.36, 0, 0.64, 1) infinite;
}
.dshsm-skeletonCard { cursor: default; min-height: 148px; }
.dshsm-skeletonRow { pointer-events: none; }
.dshsm-skeletonTitle { width: 120px; height: 12px; margin-top: 6px; }
.dshsm-skeletonSource { width: 170px; max-width: 85%; height: 10px; margin-top: 8px; }
.dshsm-skeletonLine { width: 100%; height: 10px; margin-top: 4px; }
.dshsm-skeletonLineShort { width: 62%; }
.dshsm-skeleton .dshsm-avatar { animation: none; background: var(--dsw-alias-bg-skeleton); }
@keyframes dshsm-pulse {
  0% { opacity: 1; }
  40% { opacity: 0.6; }
  80%, 100% { opacity: 1; }
}
.dshsm-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 24px;
  text-align: center;
}
.dshsm-stateCompact { padding: 20px 12px; }
.dshsm-stateIcon { display: inline-flex; color: var(--dsw-alias-label-caption); }
.dshsm-stateTitle {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
}
.dshsm-stateBody {
  max-width: 380px;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dshsm-stateActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 2px;
}
.dshsm-detail { display: flex; flex-direction: column; gap: 18px; }
.dshsm-back {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 5px;
  height: 28px;
  margin-left: -4px;
  padding: 0 8px 0 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
@media (hover: hover) {
  .dshsm-back:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dshsm-detailHead { display: flex; align-items: center; gap: 14px; min-width: 0; }
.dshsm-detailHeading { min-width: 0; }
.dshsm-detailTitle {
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
}
.dshsm-detailSource {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.dshsm-detailBody {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
  align-items: start;
}
@media (max-width: 760px) {
  .dshsm-detailBody { grid-template-columns: minmax(0, 1fr); }
}
.dshsm-detailMain { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dshsm-detailDesc {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dshsm-detailSkeleton { display: flex; flex-direction: column; gap: 8px; }
.dshsm-metaCard {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshsm-kv {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 8px 12px;
  font-size: 12.5px;
  line-height: 18px;
}
.dshsm-kvLabel { color: var(--dsw-alias-label-tertiary); }
.dshsm-kvValue {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dshsm-kvValue a { color: var(--dsw-alias-brand-text); text-decoration: none; }
.dshsm-kvValue a:hover { text-decoration: underline; }
.dshsm-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  color: var(--dsw-alias-brand-text);
  font-size: 12.5px;
  line-height: 18px;
  text-decoration: none;
}
.dshsm-link:hover { text-decoration: underline; }
.dshsm-installBtn { width: 100%; margin-top: 2px; }
.dshsm-sectionTitle {
  margin: 0 0 2px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}
.dshsm-warnTitle { color: var(--dsw-alias-state-warn-primary); }
.dshsm-muted { color: var(--dsw-alias-label-tertiary); }
.dshsm-installed { display: flex; flex-direction: column; gap: 8px; }
.dshsm-installedHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dshsm-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.dshsm-row {
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 8px;
  border-radius: 12px;
}
@media (hover: hover) {
  .dshsm-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshsm-rowMain { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.dshsm-rowTitle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}
.dshsm-rowName { overflow-wrap: anywhere; }
.dshsm-rowDesc {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12.5px;
  line-height: 18px;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}
.dshsm-rowMeta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 0;
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  line-height: 18px;
}
.dshsm-rowMeta > span + span::before { content: '·'; margin: 0 6px; }
.dshsm-rowActions { display: flex; flex: none; align-items: center; gap: 6px; }
.dshsm-badge {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
  line-height: 1;
  font-weight: 400;
}
.dshsm-badgeWarn {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 34%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}
.dshsm-badgeError {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, transparent);
  color: var(--dsw-alias-state-error-primary);
}
.dshsm-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
@media (hover: hover) {
  .dshsm-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshsm-btn:disabled { opacity: 0.55; cursor: default; }
.dshsm-btnSmall { height: 28px; padding: 0 10px; border-radius: 8px; font-size: 12.5px; }
.dshsm-btnPrimary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (hover: hover) {
  .dshsm-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
}
.dshsm-btnDanger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 32%, transparent); }
@media (hover: hover) {
  .dshsm-btnDanger:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover));
  }
}
.dshsm-btnDangerSolid {
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (hover: hover) {
  .dshsm-btnDangerSolid:hover:not(:disabled) {
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 86%, #000);
  }
}
.dshsm-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-3);
}
.dshsm-dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(86vh, 880px);
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
}
.dshsm-dialogHead {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dshsm-dialogTitleWrap { min-width: 0; }
.dshsm-dialogTitle {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}
.dshsm-dialogSubtitle {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12.5px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshsm-iconBtn {
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
@media (hover: hover) {
  .dshsm-iconBtn:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dshsm-iconBtn:disabled { opacity: 0.5; cursor: default; }
.dshsm-dialogBody {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  padding: 16px 18px;
  overflow: auto;
}
.dshsm-dialogFoot {
  display: flex;
  flex: none;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dshsm-previewLoading { display: flex; flex-direction: column; gap: 8px; }
.dshsm-previewLoadingLabel {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dshsm-previewSummary { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.dshsm-previewSummaryMain { min-width: 0; }
.dshsm-previewName {
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.dshsm-previewSource {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12.5px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.dshsm-previewDesc {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 18px;
}
.dshsm-notice {
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 34%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 18px;
}
.dshsm-notice svg { flex: none; color: var(--dsw-alias-state-warn-primary); margin-top: 1px; }
.dshsm-section { display: flex; flex-direction: column; gap: 8px; }
.dshsm-files {
  overflow: auto;
  max-height: 180px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
}
.dshsm-fileRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  font-size: 12px;
  line-height: 18px;
}
.dshsm-fileRow + .dshsm-fileRow { border-top: 1px solid var(--dsw-alias-border-l2); }
.dshsm-filePath {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dshsm-fileSize {
  flex: none;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}
.dshsm-warnings { display: flex; flex-direction: column; gap: 6px; }
.dshsm-warning {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 7%, transparent);
}
.dshsm-warningFile {
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 17px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.dshsm-warningSnippet {
  color: var(--dsw-alias-label-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 17px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dshsm-note {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dshsm-sourceSection { display: flex; flex-direction: column; gap: 6px; }
.dshsm-sourceList { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.dshsm-sourceRow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 10px;
}
@media (hover: hover) {
  .dshsm-sourceRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshsm-sourceMain { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.dshsm-sourceTitle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13.5px;
  line-height: 20px;
  font-weight: 500;
}
.dshsm-sourceUrl {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.dshsm-sourceActions { display: flex; flex: none; align-items: center; gap: 6px; }
.dshsm-sourceForm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dshsm-field { display: flex; flex-direction: column; gap: 4px; }
.dshsm-fieldLabel {
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 18px;
  font-weight: 500;
}
.dshsm-field input {
  box-sizing: border-box;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.dshsm-field input::placeholder { color: var(--dsw-alias-label-caption); }
.dshsm-fieldset {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: 0;
}
.dshsm-segmented {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshsm-segment {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 20px;
  cursor: pointer;
}
.dshsm-segment input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.dshsm-segmentActive {
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dshsm-formError {
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 18px;
}
.dshsm-formActions { display: flex; justify-content: flex-end; gap: 8px; }
.dshsm-avatarSm { width: 28px; height: 28px; border-radius: 8px; font-size: 12px; }
.dshsm-toasts {
  position: fixed;
  bottom: 28px;
  left: 50%;
  z-index: 90;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 48px);
  transform: translateX(-50%);
  pointer-events: none;
}
.dshsm-toast {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(560px, calc(100vw - 48px));
  padding: 9px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  pointer-events: auto;
}
.dshsm-toastIcon { display: inline-flex; flex: none; color: var(--dsw-alias-state-success-primary); }
.dshsm-toast[data-kind='error'] { color: var(--dsw-alias-label-primary); }
.dshsm-toast[data-kind='error'] .dshsm-toastIcon { color: var(--dsw-alias-state-error-primary); }
.dshsm-toastText { min-width: 0; overflow-wrap: anywhere; }
.dshsm-visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.dshsm-card:focus-visible,
.dshsm-tab:focus-visible,
.dshsm-btn:focus-visible,
.dshsm-iconBtn:focus-visible,
.dshsm-searchClear:focus-visible,
.dshsm-back:focus-visible,
.dshsm-link:focus-visible,
.dshsm-kvValue a:focus-visible,
.dshsm-marketSelect:focus-visible,
.dshsm-field input:focus-visible,
.dshsm-segment:focus-within {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .dshsm-skeleton, .dshsm-progress[data-active='true']::after { animation: none; }
}
@media (max-width: 560px) {
  .dshsm-head { align-items: flex-start; }
  .dshsm-row { flex-wrap: wrap; }
  .dshsm-rowActions { width: 100%; justify-content: flex-end; }
  .dshsm-dialogBody { padding: 14px; }
}
`

/** Preview file rows rendered before a "more" hint takes over. */
const PREVIEW_FILE_ROWS = 40

/** Warning rows rendered before a "more" hint takes over. */
const PREVIEW_WARNING_ROWS = 20

/** Lazily described cards per result page. */
const LAZY_DESCRIPTIONS = 12

/** Element factory for readable component trees without JSX. */
const h = React.createElement

/**
 * Translate one thrown API error.
 * @param t - translate seat.
 * @param error - thrown error with a `code`.
 * @returns the localized sentence.
 */
function describeError(t, error) {
  const code = error !== null && typeof error === 'object' ? error.code : undefined
  const key = typeof code === 'string' ? ERROR_KEYS[code] : undefined
  return key === undefined ? t('errorUnknown') : t(key)
}

/** Join class names, dropping falsy entries. */
function cx(...parts) {
  return parts.filter((part) => typeof part === 'string' && part !== '').join(' ')
}

/**
 * Build the catalog page URL for one entry, preferring an index-provided URL.
 * @param entry - catalog entry.
 * @param source - active source metadata.
 * @returns the skill page URL.
 */
function skillPageUrl(entry, source) {
  return pageUrlOf(entry, source) ?? ''
}

/**
 * Dictionary key for one source kind.
 * @param kind - source kind.
 * @returns the locale key.
 */
function sourceKindKey(kind) {
  return kind === 'index' ? 'sourceKindIndex' : 'sourceKindSkillsSh'
}

/**
 * Build the repository URL for one entry.
 * @param source - `owner/repo`.
 * @returns the GitHub URL.
 */
function repoUrl(source) {
  return `https://github.com/${String(source ?? '')}`
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

function IconBase({ size = 16, children, viewBox = '0 0 16 16' }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox,
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  }, children)
}

function SearchIcon({ size = 16 }) {
  return h(IconBase, { size },
    h('circle', { cx: 7, cy: 7, r: 4.4, stroke: 'currentColor', strokeWidth: 1.4 }),
    h('path', { d: 'M10.4 10.4 13.6 13.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
  )
}

function CloseIcon({ size = 14 }) {
  return h(IconBase, { size },
    h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
  )
}

function AlertIcon({ size = 16 }) {
  return h(IconBase, { size },
    h('path', { d: 'M8 2.6 14 13.4H2L8 2.6Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
    h('path', { d: 'M8 6.6v3.1', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
    h('circle', { cx: 8, cy: 11.7, r: 0.8, fill: 'currentColor' }),
  )
}

function ShieldIcon({ size = 16 }) {
  return h(IconBase, { size },
    h('path', { d: 'M8 2.4 13 4.4v3.5c0 3-2 5-5 6.1-3-1.1-5-3.1-5-6.1V4.4L8 2.4Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
    h('path', { d: 'M5.8 8.1 7.2 9.5 10.3 6.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

function ArrowLeftIcon({ size = 16 }) {
  return h(IconBase, { size },
    h('path', { d: 'M13 8H3.4M7 4.2 3.2 8l3.8 3.8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

function ArrowRightIcon({ size = 14 }) {
  return h(IconBase, { size },
    h('path', { d: 'M3 8h9.4M9.3 4.5 12.8 8l-3.5 3.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

function RefreshIcon({ size = 14 }) {
  return h(IconBase, { size },
    h('path', { d: 'M13 6.2A5.2 5.2 0 1 0 13.2 9.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
    h('path', { d: 'M13.3 2.6v3.8H9.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

function DownloadIcon({ size = 14 }) {
  return h(IconBase, { size },
    h('path', { d: 'M8 2.8v7.1M5.1 7.2 8 10.1l2.9-2.9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'M3.2 12.6h9.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
  )
}

function BoxIcon({ size = 32 }) {
  return h(IconBase, { size, viewBox: '0 0 32 32' },
    h('path', { d: 'M16 4 27 9.5v13L16 28 5 22.5v-13L16 4Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
    h('path', { d: 'M5 9.5 16 15l11-5.5M16 15v13', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
  )
}

function CheckIcon({ size = 14 }) {
  return h(IconBase, { size },
    h('path', { d: 'M3.2 8.4 6.6 11.8 12.9 4.6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

/**
 * The sidebar glyph: a stack of skill cards with a spark.
 * @param props - `{ size, active }` from the panellist slot.
 * @returns the 18/16 px glyph.
 */
function PanelIcon({ size = 18 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  h('rect', {
    x: 7.5, y: 5, width: 12, height: 14, rx: 2.6,
    stroke: 'currentColor', strokeWidth: 1.4, opacity: 0.5,
    transform: 'rotate(-9 13.5 12)',
  }),
  h('rect', {
    x: 5, y: 4, width: 13, height: 16, rx: 2.8,
    stroke: 'currentColor', strokeWidth: 1.5,
  }),
  h('path', {
    d: 'M8.2 8.6h6.6M8.2 12h5.2M8.2 15.4h3.4',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
  }),
  )
}

/* -------------------------------------------------------------------------- */
/* Presentational primitives                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic monogram avatar; no remote images are required.
 * @param props - `{ name, size }` where size is `md` or `lg`.
 */
function Monogram({ name, size = 'md' }) {
  const monogram = monogramOf(name)
  return h('span', {
    className: cx('dshsm-avatar', size === 'lg' && 'dshsm-avatarLg', size === 'sm' && 'dshsm-avatarSm'),
    style: { '--dshsm-hue': monogram.hue },
    'aria-hidden': 'true',
  }, monogram.letter)
}

/** Third-party trust notice shown in Discover and in the preview dialog. */
function TrustNotice({ t, compact = false }) {
  return h('div', { className: cx('dshsm-trust', compact && 'dshsm-trustCompact') },
    h('span', { className: 'dshsm-trustIcon' }, h(ShieldIcon)),
    h('div', { className: 'dshsm-trustBody' },
      h('div', { className: 'dshsm-trustTitle' }, t('trustTitle')),
      h('div', { className: 'dshsm-trustText' }, t('trustBody')),
    ),
  )
}

/** Skeleton card placeholder that reserves the real card's footprint. */
function SkeletonCard() {
  return h('div', { className: 'dshsm-card dshsm-skeletonCard', 'aria-hidden': 'true' },
    h('div', { className: 'dshsm-cardHead' },
      h('span', { className: 'dshsm-skeleton dshsm-avatar' }),
      h('div', { className: 'dshsm-cardTitleWrap' },
        h('span', { className: 'dshsm-skeleton dshsm-skeletonTitle' }),
        h('span', { className: 'dshsm-skeleton dshsm-skeletonSource' }),
      ),
    ),
    h('span', { className: 'dshsm-skeleton dshsm-skeletonLine' }),
    h('span', { className: 'dshsm-skeleton dshsm-skeletonLine dshsm-skeletonLineShort' }),
  )
}

/** Skeleton row placeholder for the installed list. */
function SkeletonRow() {
  return h('div', { className: 'dshsm-row dshsm-skeletonRow', 'aria-hidden': 'true' },
    h('span', { className: 'dshsm-skeleton dshsm-avatar' }),
    h('div', { className: 'dshsm-rowMain' },
      h('span', { className: 'dshsm-skeleton dshsm-skeletonTitle' }),
      h('span', { className: 'dshsm-skeleton dshsm-skeletonSource' }),
    ),
  )
}

/**
 * Error state with a retry affordance.
 * @param props - `{ t, title, body, onRetry, compact }`.
 */
function ErrorState({ t, title, body, onRetry, compact = false, secondaryLabel, onSecondary }) {
  const actions = []
  if (onRetry !== undefined) {
    actions.push(h('button', {
      key: 'retry',
      type: 'button',
      className: 'dshsm-btn',
      onClick: onRetry,
    }, t('retry')))
  }
  if (onSecondary !== undefined && secondaryLabel !== undefined) {
    actions.push(h('button', {
      key: 'secondary',
      type: 'button',
      className: 'dshsm-btn',
      onClick: onSecondary,
    }, secondaryLabel))
  }
  return h('div', { className: cx('dshsm-state', compact && 'dshsm-stateCompact'), role: 'alert' },
    h('span', { className: 'dshsm-stateIcon' }, h(AlertIcon, { size: compact ? 20 : 28 })),
    h('div', { className: 'dshsm-stateTitle' }, title ?? t('errorTitle')),
    body === undefined ? null : h('p', { className: 'dshsm-stateBody' }, body),
    actions.length === 0 ? null : h('div', { className: 'dshsm-stateActions' }, actions),
  )
}

/**
 * Empty state with an optional action.
 * @param props - `{ t, title, body, actionLabel, onAction, icon }`.
 */
function EmptyState({ t, title, body, actionLabel, onAction }) {
  return h('div', { className: 'dshsm-state', role: 'status' },
    h('span', { className: 'dshsm-stateIcon' }, h(BoxIcon)),
    h('div', { className: 'dshsm-stateTitle' }, title),
    body === undefined ? null : h('p', { className: 'dshsm-stateBody' }, body),
    actionLabel === undefined || onAction === undefined ? null : h('button', {
      type: 'button',
      className: 'dshsm-btn dshsm-btnPrimary',
      onClick: onAction,
    }, actionLabel),
  )
}

/**
 * Market-source manager dialog.
 *
 * Lists every source (builtin badge, kind, URL, select/remove actions) and
 * contains the add form. Esc closes it, focus starts on the title field, and
 * all actions carry labels.
 * @param props - `{ t, sources, form, formError, busy, onClose, onRetry,
 *   onFormChange, onSubmit, onSelect, onRemove }`.
 */
function SourceDialog({
  t,
  sources,
  form,
  formError,
  busy,
  onClose,
  onRetry,
  onFormChange,
  onSubmit,
  onSelect,
  onRemove,
}) {
  const titleRef = React.useRef(null)
  React.useEffect(() => {
    const previous = typeof document === 'undefined' ? null : document.activeElement
    if (titleRef.current !== null && typeof titleRef.current.focus === 'function') titleRef.current.focus()
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown, true)
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown, true)
      if (previous !== null && typeof previous.focus === 'function') previous.focus()
    }
  }, [busy, onClose])

  const list = sources !== null && Array.isArray(sources.items) ? sources.items : []
  const selectedId = sources !== null && typeof sources.selected === 'string' ? sources.selected : ''
  const loadError = sources !== null && sources.status === 'error' ? sources.error : null
  const kindOptions = SOURCE_KINDS.map((kind) => h('label', {
    key: kind,
    className: cx('dshsm-segment', form.kind === kind && 'dshsm-segmentActive'),
  },
  h('input', {
    type: 'radio',
    name: 'dshsm-source-kind',
    value: kind,
    checked: form.kind === kind,
    onChange: () => onFormChange({ ...form, kind }),
  }),
  h('span', null, t(sourceKindKey(kind))),
  ))

  return h('div', {
    className: 'dshsm-overlay',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    },
  },
  h('div', {
    className: 'dshsm-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('sourceDialogTitle'),
    tabIndex: -1,
  },
  h('div', { className: 'dshsm-dialogHead' },
    h('div', { className: 'dshsm-dialogTitleWrap' },
      h('h2', { className: 'dshsm-dialogTitle' }, t('sourceDialogTitle')),
      h('div', { className: 'dshsm-dialogSubtitle' }, t('sourceDialogSubtitle')),
    ),
    h('button', {
      type: 'button',
      className: 'dshsm-iconBtn',
      'aria-label': t('sourceClose'),
      onClick: onClose,
      disabled: busy,
    }, h(CloseIcon, { size: 16 })),
  ),
  h('div', { className: 'dshsm-dialogBody' },
    h('div', { className: 'dshsm-sourceSection' },
      h('div', { className: 'dshsm-sectionTitle' }, t('sourceListTitle')),
      loadError === null ? null : h(ErrorState, {
        t,
        compact: true,
        title: t('sourceLoadFailed'),
        body: describeError(t, loadError),
        onRetry,
      }),
      h('ul', { className: 'dshsm-sourceList' }, list.map((source) => h('li', {
        key: source.id,
        className: 'dshsm-sourceRow',
      },
      h(Monogram, { name: source.title, size: 'sm' }),
      h('div', { className: 'dshsm-sourceMain' },
        h('div', { className: 'dshsm-sourceTitle' },
          h('span', null, source.title),
          source.builtin ? h('span', { className: 'dshsm-badge' }, t('sourceBuiltin')) : null,
          h('span', { className: 'dshsm-badge' }, t(sourceKindKey(source.kind))),
        ),
        h('div', { className: 'dshsm-sourceUrl' }, source.url),
      ),
      h('div', { className: 'dshsm-sourceActions' },
        source.id === selectedId
          ? h('span', { className: 'dshsm-badge' }, t('sourceActive'))
          : h('button', {
            type: 'button',
            className: 'dshsm-btn dshsm-btnSmall',
            disabled: busy,
            onClick: () => onSelect(source.id),
          }, t('sourceUse')),
        source.builtin ? null : h('button', {
          type: 'button',
          className: 'dshsm-btn dshsm-btnSmall dshsm-btnDanger',
          'aria-label': t('sourceRemoveAria', { title: source.title }),
          disabled: busy,
          onClick: () => onRemove(source.id),
        }, t('sourceRemove')),
      ),
      ))),
    ),
    h('form', { className: 'dshsm-sourceForm', onSubmit },
      h('div', { className: 'dshsm-sectionTitle' }, t('sourceAddTitle')),
      h('label', { className: 'dshsm-field' },
        h('span', { className: 'dshsm-fieldLabel' }, t('sourceTitleLabel')),
        h('input', {
          ref: titleRef,
          type: 'text',
          value: form.title,
          maxLength: 80,
          placeholder: t('sourceTitlePlaceholder'),
          autoComplete: 'off',
          onChange: (event) => onFormChange({ ...form, title: event.currentTarget.value }),
        }),
      ),
      h('label', { className: 'dshsm-field' },
        h('span', { className: 'dshsm-fieldLabel' }, t('sourceUrlLabel')),
        h('input', {
          type: 'text',
          value: form.url,
          maxLength: 2048,
          placeholder: t('sourceUrlPlaceholder'),
          autoComplete: 'off',
          spellCheck: false,
          onChange: (event) => onFormChange({ ...form, url: event.currentTarget.value }),
        }),
      ),
      h('fieldset', { className: 'dshsm-fieldset' },
        h('legend', { className: 'dshsm-fieldLabel' }, t('sourceKindLabel')),
        h('div', { className: 'dshsm-segmented' }, kindOptions),
      ),
      h('p', { className: 'dshsm-note' }, form.kind === 'index' ? t('sourceIndexNote') : t('sourceBaseNote')),
      formError === null ? null : h('div', { className: 'dshsm-formError', role: 'alert' }, describeError(t, formError)),
      h('div', { className: 'dshsm-formActions' },
        h('button', {
          type: 'submit',
          className: 'dshsm-btn dshsm-btnPrimary',
          disabled: busy,
        }, busy ? t('sourceAdding') : t('sourceAdd')),
      ),
    ),
  ),
  ),
  )
}

/**
 * One read-only key/value row.
 * @param props - `{ label, children }`.
 */
function KeyValue({ label, children }) {
  return h(React.Fragment, null,
    h('div', { className: 'dshsm-kvLabel' }, label),
    h('div', { className: 'dshsm-kvValue' }, children),
  )
}

/**
 * Local skill path dialog.
 * @param props - `{ t, path, error, busy, onClose, onChange, onSubmit }`.
 */
function LocalInstallDialog({ t, path, error, busy, onClose, onChange, onSubmit }) {
  const inputRef = React.useRef(null)
  React.useEffect(() => {
    const previous = typeof document === 'undefined' ? null : document.activeElement
    if (inputRef.current !== null && typeof inputRef.current.focus === 'function') inputRef.current.focus()
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (previous !== null && typeof previous.focus === 'function') previous.focus()
    }
  }, [busy, onClose])

  return h('div', {
    className: 'dshsm-overlay',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    },
  },
  h('div', {
    className: 'dshsm-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('localDialogTitle'),
    tabIndex: -1,
  },
  h('div', { className: 'dshsm-dialogHead' },
    h('div', { className: 'dshsm-dialogTitleWrap' },
      h('h2', { className: 'dshsm-dialogTitle' }, t('localDialogTitle')),
      h('div', { className: 'dshsm-dialogSubtitle' }, t('localDialogSubtitle')),
    ),
    h('button', {
      type: 'button',
      className: 'dshsm-iconBtn',
      'aria-label': t('sourceClose'),
      onClick: onClose,
      disabled: busy,
    }, h(CloseIcon, { size: 16 })),
  ),
  h('form', { className: 'dshsm-dialogBody', onSubmit },
    h('label', { className: 'dshsm-field' },
      h('span', { className: 'dshsm-fieldLabel' }, t('localPathLabel')),
      h('input', {
        ref: inputRef,
        type: 'text',
        value: path,
        placeholder: t('localPathPlaceholder'),
        autoComplete: 'off',
        spellCheck: false,
        maxLength: 2048,
        onChange: (event) => onChange(event.currentTarget.value),
      }),
    ),
    h('p', { className: 'dshsm-note' }, t('localPathNote')),
    error === null ? null : h('div', { className: 'dshsm-formError', role: 'alert' }, describeError(t, error)),
    h('div', { className: 'dshsm-formActions' },
      h('button', {
        type: 'button',
        className: 'dshsm-btn',
        onClick: onClose,
        disabled: busy,
      }, t('previewCancel')),
      h('button', {
        type: 'submit',
        className: 'dshsm-btn dshsm-btnPrimary',
        disabled: busy,
      }, busy ? t('localPreviewBusy') : t('localPreview')),
    ),
  ),
  ),
  )
}

/**
 * The preview dialog. Esc closes it, a second click confirms risky installs.
 * @param props - `{ t, state, installing, onClose, onRetry, onInstall }`.
 */
function PreviewDialog({ t, state, installing, onClose, onRetry, onInstall }) {
  const closeRef = React.useRef(null)
  const dialogRef = React.useRef(null)
  React.useEffect(() => {
    const previous = typeof document === 'undefined' ? null : document.activeElement
    if (closeRef.current !== null && typeof closeRef.current.focus === 'function') closeRef.current.focus()
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || installing) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (previous !== null && typeof previous.focus === 'function') previous.focus()
    }
  }, [installing, onClose])

  const ready = state !== null && state.status === 'ready' && state.data !== null && typeof state.data === 'object'
  const data = ready ? state.data : null
  const warnings = data !== null && Array.isArray(data.warnings) ? data.warnings : []
  const warningTotal = data !== null && Number.isFinite(data.warningTotal) ? data.warningTotal : warnings.length
  const files = data !== null && Array.isArray(data.files) ? data.files : []
  const needsArm = data !== null && (warningTotal > 0 || data.existing === true)
  let actionLabel = t('install')
  if (data !== null && data.existing === true) actionLabel = t('previewReplace')
  else if (warningTotal > 0) actionLabel = t('previewInstallAnyway')
  if (state !== null && state.armed === true) actionLabel = t('previewConfirmAgain')

  return h('div', {
    className: 'dshsm-overlay',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget && !installing) onClose()
    },
  },
  h('div', {
    className: 'dshsm-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('previewTitle'),
    tabIndex: -1,
    ref: dialogRef,
  },
  h('div', { className: 'dshsm-dialogHead' },
    h('div', { className: 'dshsm-dialogTitleWrap' },
      h('h2', { className: 'dshsm-dialogTitle' }, t('previewTitle')),
      data === null ? null : h('div', { className: 'dshsm-dialogSubtitle' }, `${data.name} · ${data.kind === 'local' ? t('previewLocalSource') : data.source}`),
    ),
    h('button', {
      type: 'button',
      className: 'dshsm-iconBtn',
      'aria-label': t('previewClose'),
      ref: closeRef,
      onClick: onClose,
      disabled: installing,
    }, h(CloseIcon, { size: 16 })),
  ),
  h('div', { className: 'dshsm-dialogBody' },
    state !== null && state.status === 'loading'
      ? h('div', { className: 'dshsm-previewLoading', role: 'status', 'aria-live': 'polite' },
        h('div', { className: 'dshsm-previewLoadingLabel' }, t('previewLoading')),
        h('span', { className: 'dshsm-skeleton dshsm-skeletonLine' }),
        h('span', { className: 'dshsm-skeleton dshsm-skeletonLine' }),
        h('span', { className: 'dshsm-skeleton dshsm-skeletonLine dshsm-skeletonLineShort' }),
      )
      : null,
    state !== null && state.status === 'error'
      ? h(ErrorState, {
        t,
        title: t('previewError'),
        body: describeError(t, state.error),
        onRetry,
        compact: true,
      })
      : null,
    ready
      ? h(React.Fragment, null,
        h('div', { className: 'dshsm-previewSummary' },
          h(Monogram, { name: data.name, size: 'lg' }),
          h('div', { className: 'dshsm-previewSummaryMain' },
            h('div', { className: 'dshsm-previewName' }, data.name),
            h('div', { className: 'dshsm-previewSource' }, data.kind === 'local' ? t('previewLocalSource') : data.source),
            data.description !== undefined && data.description !== ''
              ? h('p', { className: 'dshsm-previewDesc' }, summarizeDescription(data.description, 280))
              : null,
          ),
        ),
        h('div', { className: 'dshsm-kv' },
          data.kind === 'local'
            ? h(KeyValue, { label: t('previewLocalPath') }, data.localPath)
            : h(React.Fragment, null,
              h(KeyValue, { label: t('previewRepo') },
                h('a', {
                  href: safeHttpsUrl(data.repo) ?? safeHttpsUrl(repoUrl(data.source)) ?? '#',
                  target: '_blank',
                  rel: 'noreferrer noopener',
                }, data.source),
              ),
              h(KeyValue, { label: t('previewBranch') }, data.branch),
              h(KeyValue, { label: t('previewPath') }, data.path),
            ),
          h(KeyValue, { label: t('previewFiles') }, t('fileCount', { count: files.length })),
          h(KeyValue, { label: t('previewSize') }, formatBytes(data.totalBytes)),
          h(KeyValue, { label: t('previewTarget') },
            typeof data.target === 'string' && data.target !== ''
              ? data.target
              : `~/.dsh/skills/${data.name}`,
          ),
        ),
        data.existing === true
          ? h('div', { className: 'dshsm-notice' }, h(AlertIcon, { size: 15 }), h('span', null, t('previewExisting')))
          : null,
        h('div', { className: 'dshsm-section' },
          h('div', { className: 'dshsm-sectionTitle' }, t('previewFilesTitle')),
          h('div', { className: 'dshsm-files' },
            files.slice(0, PREVIEW_FILE_ROWS).map((file) => h('div', {
              key: String(file.path),
              className: 'dshsm-fileRow',
            },
            h('span', { className: 'dshsm-filePath' }, file.path),
            h('span', { className: 'dshsm-fileSize' }, formatBytes(file.size)),
            )),
          ),
          files.length > PREVIEW_FILE_ROWS
            ? h('p', { className: 'dshsm-note' }, t('previewMoreFiles', { count: files.length - PREVIEW_FILE_ROWS }))
            : null,
        ),
        h('div', { className: 'dshsm-section' },
          h('div', { className: cx('dshsm-sectionTitle', warningTotal > 0 && 'dshsm-warnTitle') },
            t('previewWarnings', { count: warningTotal }),
          ),
          warningTotal === 0
            ? h('p', { className: 'dshsm-note' }, t('previewNoWarnings'))
            : h(React.Fragment, null,
              h('div', { className: 'dshsm-warnings' },
                warnings.slice(0, PREVIEW_WARNING_ROWS).map((warning, index) => h('div', {
                  key: `${warning.file}:${warning.line}:${index}`,
                  className: 'dshsm-warning',
                },
                h('div', { className: 'dshsm-warningFile' }, `${String(warning.file ?? '')}:${String(warning.line ?? '')}`),
                h('div', { className: 'dshsm-warningSnippet' }, String(warning.snippet ?? '')),
                )),
              ),
              warningTotal > warnings.length
                ? h('p', { className: 'dshsm-note' }, t('previewMoreWarnings', { count: warningTotal - warnings.length }))
                : null,
              h('p', { className: 'dshsm-note' }, t('previewWarningsHint')),
            ),
        ),
        h(TrustNotice, { t, compact: true }),
      )
      : null,
  ),
  h('div', { className: 'dshsm-dialogFoot' },
    h('button', {
      type: 'button',
      className: 'dshsm-btn',
      onClick: onClose,
      disabled: installing,
    }, t('previewCancel')),
    h('button', {
      type: 'button',
      className: cx('dshsm-btn', 'dshsm-btnPrimary', needsArm && state !== null && state.armed === true && 'dshsm-btnDangerSolid'),
      onClick: onInstall,
      disabled: !ready || installing,
    }, installing ? t('installing') : actionLabel),
  ),
  ),
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build the main-slot page component for one API client.
 * @param options.api - same-origin API client.
 * @param options.fallbackT - translate seat bound by the entry.
 * @param options.getLocale - returns the active locale id.
 * @returns the page component.
 */
function createMarketPage({ api, fallbackT, getLocale }) {
  /**
   * Skills market page.
   * @param props - slot props; `t` is supplied by the slot's locale seat.
   * @returns the page element tree.
   */
  function MarketPage(props) {
    const t = props !== null && typeof props?.t === 'function' ? props.t : fallbackT
    const locale = typeof getLocale === 'function' ? getLocale() : 'en'
    const [view, setView] = React.useState('discover')
    const [detail, setDetail] = React.useState(null)
    const [query, setQuery] = React.useState('')
    const [search, setSearch] = React.useState({
      status: 'loading',
      items: [],
      seed: true,
      cached: false,
      warning: null,
      error: null,
      query: '',
      source: null,
    })
    const [descriptions, setDescriptions] = React.useState({})
    const [installed, setInstalled] = React.useState({ status: 'idle', items: [], error: null })
    const [sources, setSources] = React.useState({ status: 'loading', items: [], selected: '', error: null })
    const [sourcesOpen, setSourcesOpen] = React.useState(false)
    const [sourceForm, setSourceForm] = React.useState({ kind: 'skills-sh', title: '', url: '' })
    const [sourceFormError, setSourceFormError] = React.useState(null)
    const [sourceBusy, setSourceBusy] = React.useState(false)
    const [localOpen, setLocalOpen] = React.useState(false)
    const [localPath, setLocalPath] = React.useState('')
    const [localError, setLocalError] = React.useState(null)
    const [localBusy, setLocalBusy] = React.useState(false)
    const [preview, setPreview] = React.useState(null)
    const [installing, setInstalling] = React.useState(false)
    const [removal, setRemoval] = React.useState({ name: null, armed: null, busy: false })
    const [toasts, setToasts] = React.useState([])
    const toastId = React.useRef(0)
    const searchSeq = React.useRef(0)
    const detailSeq = React.useRef(0)
    const previewSeq = React.useRef(0)
    const debounceTimer = React.useRef(null)
    const mounted = React.useRef(true)
    const discoverTab = React.useRef(null)
    const installedTab = React.useRef(null)

    React.useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
        if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
      }
    }, [])

    const pushToast = React.useCallback((kind, message) => {
      toastId.current += 1
      const id = toastId.current
      setToasts((list) => [...list.slice(-2), { id, kind, message }])
    }, [])

    React.useEffect(() => {
      if (toasts.length === 0) return undefined
      const id = toasts[0].id
      const timer = setTimeout(() => {
        setToasts((list) => list.filter((item) => item.id !== id))
      }, 4200)
      return () => { clearTimeout(timer) }
    }, [toasts])

    const activeSource = sources.items.find((source) => source.id === sources.selected) ?? sources.items[0] ?? null
    const activeSourceId = activeSource === null ? undefined : activeSource.id

    const loadSources = React.useCallback(async () => {
      setSources((previous) => ({ ...previous, status: 'loading', error: null }))
      try {
        const payload = await api.sources()
        const normalized = normalizeSources(payload)
        setSources({ status: 'ready', items: normalized.sources, selected: normalized.selected, error: null })
      } catch (error) {
        setSources((previous) => ({ ...previous, status: 'error', error }))
      }
    }, [api])

    React.useEffect(() => {
      void loadSources()
    }, [loadSources])

    React.useEffect(() => {
      setDetail(null)
      setDescriptions({})
    }, [activeSourceId])

    const selectSource = React.useCallback(async (id, closeManager) => {
      if (id === undefined || id === null || id === '') return
      if (id === '__manage__') {
        setSourcesOpen(true)
        return
      }
      if (sourceBusy) return
      setSourceBusy(true)
      try {
        const payload = await api.selectSource(id)
        const normalized = normalizeSources(payload)
        setSources({ status: 'ready', items: normalized.sources, selected: normalized.selected, error: null })
        setDetail(null)
        setDescriptions({})
        if (closeManager === true) setSourcesOpen(false)
      } catch (error) {
        pushToast('error', describeError(t, error))
      } finally {
        setSourceBusy(false)
      }
    }, [api, pushToast, sourceBusy, t])

    const submitSource = async (event) => {
      event.preventDefault()
      if (sourceBusy) return
      setSourceFormError(null)
      const title = sourceForm.title.trim()
      const url = sourceForm.url.trim()
      if (title === '') {
        setSourceFormError({ code: 'sources/invalid', message: 'title' })
        return
      }
      if (url === '') {
        setSourceFormError({ code: 'sources/invalid', message: 'url' })
        return
      }
      setSourceBusy(true)
      try {
        const payload = await api.addSource({ kind: sourceForm.kind, title, url })
        const normalized = normalizeSources(payload)
        setSources({ status: 'ready', items: normalized.sources, selected: normalized.selected, error: null })
        setSourceForm({ kind: 'skills-sh', title: '', url: '' })
        setSourcesOpen(false)
        const created = payload !== null && typeof payload === 'object' && payload.source !== null && typeof payload.source === 'object'
          ? payload.source.id
          : undefined
        if (typeof created === 'string' && created !== '') {
          const selectedPayload = await api.selectSource(created)
          const selected = normalizeSources(selectedPayload)
          setSources({ status: 'ready', items: selected.sources, selected: selected.selected, error: null })
        }
      } catch (error) {
        setSourceFormError(error)
      } finally {
        setSourceBusy(false)
      }
    }

    const removeSource = async (id) => {
      if (sourceBusy) return
      setSourceBusy(true)
      try {
        const payload = await api.removeSource(id)
        const normalized = normalizeSources(payload)
        setSources({ status: 'ready', items: normalized.sources, selected: normalized.selected, error: null })
      } catch (error) {
        pushToast('error', describeError(t, error))
      } finally {
        setSourceBusy(false)
      }
    }

    const runSearch = React.useCallback(async (text) => {
      searchSeq.current += 1
      const seq = searchSeq.current
      setSearch((previous) => ({ ...previous, status: 'loading', error: null, warning: null }))
      try {
        const payload = await api.search(text, activeSourceId)
        if (!mounted.current || searchSeq.current !== seq) return
        const market = payload !== null && typeof payload === 'object' && payload.source !== null && typeof payload.source === 'object'
          ? {
            id: typeof payload.source.id === 'string' ? payload.source.id : '',
            kind: typeof payload.source.kind === 'string' ? payload.source.kind : '',
            title: typeof payload.source.title === 'string' ? payload.source.title : '',
            url: typeof payload.source.url === 'string' ? payload.source.url : '',
          }
          : null
        setSearch({
          status: 'ready',
          items: normalizeSkills(payload.skills),
          seed: payload.seed === true,
          cached: payload.cached === true,
          warning: typeof payload.warning === 'string' ? payload.warning : null,
          error: null,
          query: typeof payload.query === 'string' ? payload.query : text,
          source: market,
        })
      } catch (error) {
        if (!mounted.current || searchSeq.current !== seq) return
        setSearch((previous) => ({ ...previous, status: 'error', error }))
      }
    }, [activeSourceId, api])

    React.useEffect(() => {
      void runSearch('')
    }, [runSearch])

    React.useEffect(() => {
      if (view !== 'discover' || detail !== null) return undefined
      if (query.trim() === search.query) return undefined
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null
        void runSearch(query)
      }, 300)
      return () => {
        if (debounceTimer.current !== null) {
          clearTimeout(debounceTimer.current)
          debounceTimer.current = null
        }
      }
    }, [query, view, detail, search.query, runSearch])

    React.useEffect(() => {
      if (search.status !== 'ready' || search.items.length === 0) return undefined
      const seeded = {}
      for (const item of search.items) {
        const key = skillKey(item)
        if (descriptions[key] !== undefined || typeof item.description !== 'string' || item.description === '') continue
        seeded[key] = item.description
      }
      if (Object.keys(seeded).length > 0) {
        setDescriptions((previous) => ({ ...seeded, ...previous }))
      }
      const missing = []
      const seen = new Set()
      for (const item of search.items.slice(0, LAZY_DESCRIPTIONS)) {
        const key = skillKey(item)
        if (descriptions[key] !== undefined || seeded[key] !== undefined || seen.has(key)) continue
        seen.add(key)
        missing.push(item)
      }
      if (missing.length === 0) return undefined
      let cancelled = false
      let cursor = 0
      const worker = async () => {
        while (!cancelled && cursor < missing.length) {
          const item = missing[cursor]
          cursor += 1
          const key = skillKey(item)
          try {
            const payload = await api.detail(item.source, item.skillId, search.source?.id ?? activeSourceId)
            if (!cancelled) {
              setDescriptions((previous) => previous[key] !== undefined
                ? previous
                : { ...previous, [key]: typeof payload.description === 'string' ? payload.description : '' })
            }
          } catch {
            if (!cancelled) {
              setDescriptions((previous) => previous[key] !== undefined ? previous : { ...previous, [key]: '' })
            }
          }
        }
      }
      void Promise.all([worker(), worker()])
      return () => { cancelled = true }
      // `descriptions` is intentionally excluded: the effect seeds the cache
      // for the current result page and must not loop on its own writes.
    }, [activeSourceId, api, search.source, search.status, search.items])

    const loadDetail = React.useCallback((entry) => {
      const key = skillKey(entry)
      const known = descriptions[key]
      setDetail({
        entry,
        description: known ?? '',
        status: known === undefined ? 'loading' : 'ready',
        error: null,
      })
      if (known !== undefined) return
      detailSeq.current += 1
      const seq = detailSeq.current
      api.detail(entry.source, entry.skillId, search.source?.id ?? activeSourceId).then((payload) => {
        if (!mounted.current || detailSeq.current !== seq) return
        const description = typeof payload.description === 'string' ? payload.description : ''
        setDescriptions((previous) => ({ ...previous, [key]: description }))
        setDetail((previous) => previous !== null && skillKey(previous.entry) === key
          ? { ...previous, description, status: 'ready', error: null }
          : previous)
      }).catch((error) => {
        if (!mounted.current || detailSeq.current !== seq) return
        setDetail((previous) => previous !== null && skillKey(previous.entry) === key
          ? { ...previous, status: 'error', error }
          : previous)
      })
    }, [activeSourceId, api, descriptions, search.source])

    const retryDetail = React.useCallback(() => {
      if (detail !== null) loadDetail(detail.entry)
    }, [detail, loadDetail])

    const loadInstalled = React.useCallback(async () => {
      setInstalled((previous) => ({ status: 'loading', items: previous.items, error: null }))
      try {
        const payload = await api.installed()
        if (!mounted.current) return
        setInstalled({ status: 'ready', items: normalizeInstalled(payload.skills), error: null })
      } catch (error) {
        if (!mounted.current) return
        setInstalled((previous) => ({ status: 'error', items: previous.items, error }))
      }
    }, [api])

    React.useEffect(() => {
      if (view === 'installed' && installed.status === 'idle') void loadInstalled()
    }, [view, installed.status, loadInstalled])

    const switchView = (next) => {
      setDetail(null)
      setView(next)
      const target = next === 'discover' ? discoverTab.current : installedTab.current
      if (target !== null && typeof target.focus === 'function') {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => { target.focus() })
        } else {
          target.focus()
        }
      }
    }

    const submitSearch = (event) => {
      event.preventDefault()
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      void runSearch(query)
    }

    const clearSearch = () => {
      setQuery('')
      // Mark the pending query empty so the debounce effect does not schedule a
      // second identical request while the immediate one is in flight.
      setSearch((previous) => ({ ...previous, query: '' }))
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      void runSearch('')
    }

    const openPreview = async (entry) => {
      previewSeq.current += 1
      const seq = previewSeq.current
      setPreview({ status: 'loading', entry, data: null, error: null, armed: false })
      try {
        const payload = await api.preview({ source: entry.source, skillId: entry.skillId })
        if (!mounted.current || previewSeq.current !== seq) return
        setPreview({ status: 'ready', entry, data: payload, error: null, armed: false })
      } catch (error) {
        if (!mounted.current || previewSeq.current !== seq) return
        setPreview({ status: 'error', entry, data: null, error, armed: false })
      }
    }

    const openLocalPreview = async (path) => {
      previewSeq.current += 1
      const seq = previewSeq.current
      const entry = { kind: 'local', path }
      setPreview({ status: 'loading', entry, data: null, error: null, armed: false })
      try {
        const payload = await api.previewLocal(path)
        if (!mounted.current || previewSeq.current !== seq) return
        setPreview({ status: 'ready', entry, data: payload, error: null, armed: false })
      } catch (error) {
        if (!mounted.current || previewSeq.current !== seq) return
        setPreview({ status: 'error', entry, data: null, error, armed: false })
      }
    }

    const submitLocal = async (event) => {
      event.preventDefault()
      if (localBusy) return
      const path = localPath.trim()
      if (path === '') return
      setLocalBusy(true)
      setLocalError(null)
      setLocalOpen(false)
      try {
        await openLocalPreview(path)
      } finally {
        if (mounted.current) setLocalBusy(false)
      }
    }

    const closePreview = React.useCallback(() => {
      if (installing) return
      previewSeq.current += 1
      setPreview(null)
    }, [installing])

    const confirmInstall = async () => {
      if (preview === null || preview.status !== 'ready' || installing) return
      const data = preview.data
      if (data === null || typeof data !== 'object') return
      const warnings = Array.isArray(data.warnings) ? data.warnings : []
      const needsArm = warnings.length > 0 || data.existing === true
      if (needsArm && preview.armed !== true) {
        setPreview({ ...preview, armed: true })
        return
      }
      setInstalling(true)
      try {
        const result = await api.install({ token: data.token, replace: data.existing === true })
        if (!mounted.current) return
        setPreview(null)
        pushToast('success', t('installSuccess', { name: result.name ?? data.name }))
        setInstalled((previous) => ({ ...previous, status: 'loading' }))
        void loadInstalled()
      } catch (error) {
        if (!mounted.current) return
        pushToast('error', describeError(t, error))
        setPreview((previous) => previous === null ? previous : { ...previous, armed: false })
      } finally {
        if (mounted.current) setInstalling(false)
      }
    }

    const cancelRemove = () => setRemoval({ name: null, armed: null, busy: false })

    const commitRemove = async (name) => {
      setRemoval({ name, armed: name, busy: true })
      try {
        await api.remove(name)
        if (!mounted.current) return
        setRemoval({ name: null, armed: null, busy: false })
        pushToast('success', t('removeSuccess', { name }))
      } catch (error) {
        if (!mounted.current) return
        setRemoval({ name: null, armed: null, busy: false })
        pushToast('error', describeError(t, error))
      }
      setInstalled((previous) => ({ ...previous, status: 'loading' }))
      void loadInstalled()
    }

    const requestRemove = (name) => {
      if (removal.busy) return
      if (removal.name === name && removal.armed === name) {
        void commitRemove(name)
        return
      }
      setRemoval({ name, armed: name, busy: false })
    }

    React.useEffect(() => {
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return
        if (preview !== null) return
        if (detail !== null) setDetail(null)
      }
      window.addEventListener('keydown', onKeyDown)
      return () => { window.removeEventListener('keydown', onKeyDown) }
    }, [preview, detail])

    const onTabKeyDown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      switchView(view === 'discover' ? 'installed' : 'discover')
    }

    /* ---------------------------------------------------------------- */
    /* Discover                                                          */
    /* ---------------------------------------------------------------- */

    const renderDiscover = () => {
      const loading = search.status === 'loading'
      const hasItems = search.items.length > 0
      const showWarning = search.warning !== null && !loading
      return h(React.Fragment, null,
        h('form', { className: 'dshsm-toolbar', role: 'search', onSubmit: submitSearch },
          h('div', { className: 'dshsm-sourcePick' },
            h('select', {
              className: 'dshsm-sourceSelect',
              value: activeSourceId ?? '',
              disabled: sourceBusy || sources.status === 'loading',
              'aria-label': t('sourceSwitcherLabel'),
              onChange: (event) => { void selectSource(event.currentTarget.value); },
            },
            sources.items.length === 0
              ? h('option', { value: '' }, sources.status === 'loading' ? t('loading') : t('sourceUnavailable'))
              : sources.items.map((source) => h('option', { key: source.id, value: source.id }, source.title)),
            h('option', { value: '__manage__' }, t('sourceManage')),
            ),
          ),
          h('div', { className: 'dshsm-search' },
            h('span', { className: 'dshsm-searchIcon' }, h(SearchIcon)),
            h('input', {
              type: 'search',
              value: query,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchLabel'),
              autoComplete: 'off',
              spellCheck: false,
              maxLength: 200,
              onChange: (event) => { setQuery(event.currentTarget.value) },
            }),
            query === '' ? null : h('button', {
              type: 'button',
              className: 'dshsm-searchClear',
              'aria-label': t('clearSearch'),
              onClick: clearSearch,
            }, h(CloseIcon, { size: 13 })),
          ),
          h('button', {
            type: 'button',
            className: 'dshsm-btn dshsm-btnSmall',
            onClick: () => { setLocalError(null); setLocalOpen(true) },
          }, t('localInstall')),
        ),
        h('div', {
          className: 'dshsm-progress',
          'data-active': loading && hasItems ? 'true' : 'false',
          'aria-hidden': 'true',
        }),
        showWarning
          ? h('div', { className: 'dshsm-warnBanner', role: 'status' },
            h('span', { className: 'dshsm-warnBannerIcon' }, h(AlertIcon, { size: 15 })),
            h('span', { className: 'dshsm-warnBannerText' },
              search.warning === 'query' ? t('warningQuery') : t('warningOffline')),
            h('button', {
              type: 'button',
              className: 'dshsm-btn dshsm-btnSmall',
              onClick: () => { void runSearch(query) },
            }, t('retry')),
          )
          : null,
        search.status === 'error' && hasItems
          ? h('div', { className: 'dshsm-warnBanner', role: 'alert' },
            h('span', { className: 'dshsm-warnBannerIcon' }, h(AlertIcon, { size: 15 })),
            h('span', { className: 'dshsm-warnBannerText' }, t('errorBody')),
            h('button', {
              type: 'button',
              className: 'dshsm-btn dshsm-btnSmall',
              onClick: () => { void runSearch(query) },
            }, t('retry')),
          )
          : null,
        h('div', { className: 'dshsm-resultsHead' },
          h('span', { className: 'dshsm-resultsLabel' },
            search.seed ? t('seedLabel') : t('resultsLabel', { count: search.items.length })),
          h('span', { className: 'dshsm-resultsSource' },
            (search.source !== null && search.source !== undefined && typeof search.source.title === 'string'
              ? search.source.title
              : (activeSource === null ? '' : activeSource.title))),
          search.cached ? h('span', { className: 'dshsm-resultsHint' }, t('cachedLabel')) : null,
        ),
        h(TrustNotice, { t }),
        !hasItems && loading
          ? h('div', { className: 'dshsm-grid', 'aria-busy': 'true' },
            h('span', { className: 'dshsm-visuallyHidden' }, t('skeletonLabel')),
            [0, 1, 2, 3, 4, 5].map((index) => h(SkeletonCard, { key: index })),
          )
          : null,
        !hasItems && search.status === 'error'
          ? h(ErrorState, {
            t,
            title: t('errorTitle'),
            body: describeError(t, search.error) === t('errorUnknown') ? t('errorBody') : describeError(t, search.error),
            onRetry: () => { void runSearch(query) },
            secondaryLabel: t('sourceManage'),
            onSecondary: () => { setSourcesOpen(true) },
          })
          : null,
        !hasItems && search.status === 'ready'
          ? h(EmptyState, {
            t,
            title: t('emptyResults', { query: search.query !== '' ? search.query : query }),
            actionLabel: t('retry'),
            onAction: () => { void runSearch(query) },
          })
          : null,
        hasItems
          ? h('div', { className: 'dshsm-grid' },
            search.items.map((item) => {
              const key = skillKey(item)
              const description = descriptions[key]
              return h('div', {
                key,
                className: 'dshsm-card',
                role: 'button',
                tabIndex: 0,
                'aria-label': t('cardOpen', { name: item.name }),
                onClick: () => { loadDetail(item) },
                onKeyDown: (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  loadDetail(item)
                },
              },
              h('div', { className: 'dshsm-cardHead' },
                h(Monogram, { name: item.name }),
                h('div', { className: 'dshsm-cardTitleWrap' },
                  h('div', { className: 'dshsm-cardTitle' }, item.name),
                  h('div', { className: 'dshsm-cardSource' }, item.source),
                ),
              ),
              h('p', { className: 'dshsm-cardDesc' },
                description === undefined
                  ? h('span', { className: 'dshsm-skeleton dshsm-skeletonLine dshsm-cardDescSkeleton', 'aria-hidden': 'true' })
                  : description === '' ? t('noDescription') : summarizeDescription(description, CARD_DESCRIPTION_LIMIT),
              ),
              h('div', { className: 'dshsm-cardFoot' },
                h('span', { className: 'dshsm-cardInstalls' },
                  `${formatCount(item.installs)} ${t('installsSuffix')}`),
                h('span', { className: 'dshsm-cardArrow', 'aria-hidden': 'true' }, h(ArrowRightIcon)),
              ),
              )
            }),
          )
          : null,
      )
    }

    /* ---------------------------------------------------------------- */
    /* Detail                                                            */
    /* ---------------------------------------------------------------- */

    const renderDetail = () => {
      const entry = detail.entry
      const description = detail.status === 'ready'
        ? summarizeDescription(detail.description, 1200)
        : ''
      const pageUrl = safeHttpsUrl(skillPageUrl(entry))
      const repository = safeHttpsUrl(repoUrl(entry.source))
      const installingPreview = preview !== null
        && preview.status === 'loading'
        && skillKey(preview.entry) === skillKey(entry)
      return h('div', { className: 'dshsm-detail' },
        h('button', {
          type: 'button',
          className: 'dshsm-back',
          onClick: () => { setDetail(null) },
        }, h(ArrowLeftIcon), t('back')),
        h('div', { className: 'dshsm-detailHead' },
          h(Monogram, { name: entry.name, size: 'lg' }),
          h('div', { className: 'dshsm-detailHeading' },
            h('h2', { className: 'dshsm-detailTitle' }, entry.name),
            h('div', { className: 'dshsm-detailSource' }, entry.source),
          ),
        ),
        h('div', { className: 'dshsm-detailBody' },
          h('div', { className: 'dshsm-detailMain' },
            h('h3', { className: 'dshsm-sectionTitle' }, t('detailAbout')),
            detail.status === 'loading'
              ? h('div', { className: 'dshsm-detailSkeleton', 'aria-busy': 'true' },
                h('span', { className: 'dshsm-visuallyHidden' }, t('skeletonLabel')),
                h('span', { className: 'dshsm-skeleton dshsm-skeletonLine' }),
                h('span', { className: 'dshsm-skeleton dshsm-skeletonLine' }),
                h('span', { className: 'dshsm-skeleton dshsm-skeletonLine dshsm-skeletonLineShort' }),
              )
              : detail.status === 'error'
                ? h(ErrorState, {
                  t,
                  compact: true,
                  title: t('errorTitle'),
                  body: t('errorBody'),
                  onRetry: retryDetail,
                })
                : description === ''
                  ? h('p', { className: 'dshsm-detailDesc dshsm-muted' }, t('noDescription'))
                  : h('p', { className: 'dshsm-detailDesc' }, description),
          ),
          h('aside', { className: 'dshsm-metaCard' },
            h('div', { className: 'dshsm-kv' },
              h(KeyValue, { label: t('detailSource') },
                repository === null ? entry.source : h('a', {
                  href: repository,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                }, entry.source),
              ),
              h(KeyValue, { label: t('detailInstalls') },
                `${formatCount(entry.installs)} ${t('installsSuffix')}`),
            ),
            pageUrl === null ? null : h('a', {
              className: 'dshsm-link',
              href: pageUrl,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, t('detailOpenPage'), h(ArrowRightIcon, { size: 12 })),
            h('button', {
              type: 'button',
              className: 'dshsm-btn dshsm-btnPrimary dshsm-installBtn',
              disabled: installingPreview,
              onClick: () => { void openPreview(entry) },
            }, h(DownloadIcon), installingPreview ? t('preparing') : t('install')),
          ),
        ),
      )
    }

    /* ---------------------------------------------------------------- */
    /* Installed                                                         */
    /* ---------------------------------------------------------------- */

    const renderInstalledRow = (item) => {
      const busy = removal.busy && removal.name === item.name
      const armed = removal.name === item.name && removal.armed === item.name
      const meta = []
      if (typeof item.source === 'string' && item.source !== '') meta.push(item.source)
      if (typeof item.installedAt === 'string') {
        const installedAt = formatDate(item.installedAt, locale)
        if (installedAt !== '') meta.push(t('installedAt', { date: installedAt }))
      }
      if (item.writable === false) meta.push(t('installedReadonly'))
      return h('li', { key: item.path ?? item.name, className: 'dshsm-row' },
        h(Monogram, { name: item.name }),
        h('div', { className: 'dshsm-rowMain' },
          h('div', { className: 'dshsm-rowTitle' },
            h('span', { className: 'dshsm-rowName' }, item.name),
            item.warnings > 0
              ? h('span', { className: 'dshsm-badge dshsm-badgeWarn' }, t('installedWarnings', { count: item.warnings }))
              : null,
            item.valid === false
              ? h('span', { className: 'dshsm-badge dshsm-badgeError' }, t('installedInvalid'))
              : null,
            item.managed ? h('span', { className: 'dshsm-badge' }, t('installedManaged')) : null,
          ),
          item.description === ''
            ? null
            : h('div', { className: 'dshsm-rowDesc' }, summarizeDescription(item.description, CARD_DESCRIPTION_LIMIT)),
          meta.length === 0
            ? null
            : h('div', { className: 'dshsm-rowMeta' }, meta.map((text, index) => h('span', { key: index }, text))),
        ),
        item.managed
          ? h('div', { className: 'dshsm-rowActions' },
            armed
              ? h(React.Fragment, null,
                h('button', {
                  type: 'button',
                  className: 'dshsm-btn dshsm-btnSmall dshsm-btnDanger',
                  disabled: busy,
                  onClick: () => { void commitRemove(item.name) },
                }, busy ? t('removeBusy') : t('removeConfirm')),
                h('button', {
                  type: 'button',
                  className: 'dshsm-btn dshsm-btnSmall',
                  disabled: busy,
                  onClick: cancelRemove,
                }, t('previewCancel')),
              )
              : h('button', {
                type: 'button',
                className: 'dshsm-btn dshsm-btnSmall',
                'aria-label': t('removeAria', { name: item.name }),
                disabled: busy,
                onClick: () => { requestRemove(item.name) },
              }, t('remove')),
          )
          : null,
      )
    }

    const renderInstalled = () => {
      const list = installed.items
      const loading = installed.status === 'loading'
      return h('div', { className: 'dshsm-installed' },
        h('div', { className: 'dshsm-installedHead' },
          h('span', { className: 'dshsm-resultsLabel' }, t('installedCount', { count: list.length })),
          h('button', {
            type: 'button',
            className: 'dshsm-btn dshsm-btnSmall',
            disabled: loading,
            onClick: () => { void loadInstalled() },
          }, h(RefreshIcon), loading ? t('loading') : t('refresh')),
        ),
        h('div', {
          className: 'dshsm-progress',
          'data-active': loading && list.length > 0 ? 'true' : 'false',
          'aria-hidden': 'true',
        }),
        installed.status === 'error' && list.length > 0
          ? h('div', { className: 'dshsm-warnBanner', role: 'alert' },
            h('span', { className: 'dshsm-warnBannerIcon' }, h(AlertIcon, { size: 15 })),
            h('span', { className: 'dshsm-warnBannerText' }, describeError(t, installed.error)),
            h('button', {
              type: 'button',
              className: 'dshsm-btn dshsm-btnSmall',
              onClick: () => { void loadInstalled() },
            }, t('retry')),
          )
          : null,
        loading && list.length === 0
          ? h('div', { className: 'dshsm-list', 'aria-busy': 'true' },
            h('span', { className: 'dshsm-visuallyHidden' }, t('skeletonLabel')),
            [0, 1, 2].map((index) => h(SkeletonRow, { key: index })),
          )
          : null,
        installed.status === 'error' && list.length === 0
          ? h(ErrorState, {
            t,
            title: t('errorTitle'),
            body: describeError(t, installed.error),
            onRetry: () => { void loadInstalled() },
          })
          : null,
        installed.status === 'ready' && list.length === 0
          ? h(EmptyState, {
            t,
            title: t('installedEmpty'),
            body: t('installedEmptyHint'),
            actionLabel: t('goDiscover'),
            onAction: () => { switchView('discover') },
          })
          : null,
        list.length > 0
          ? h('ul', { className: 'dshsm-list' }, list.map(renderInstalledRow))
          : null,
      )
    }

    /* ---------------------------------------------------------------- */
    /* Shell                                                             */
    /* ---------------------------------------------------------------- */

    const body = detail !== null
      ? renderDetail()
      : view === 'discover' ? renderDiscover() : renderInstalled()

    return h('div', { className: 'dshsm-page', 'data-plugin': PANEL_ID },
      h('div', { className: 'dshsm-head' },
        h('div', { className: 'dshsm-heading' },
          h('h1', { className: 'dshsm-title' }, t('title')),
          h('p', { className: 'dshsm-intro' }, t('intro')),
        ),
        h('div', { className: 'dshsm-tabs', role: 'tablist', 'aria-label': t('title'), onKeyDown: onTabKeyDown },
          h('button', {
            type: 'button',
            role: 'tab',
            ref: discoverTab,
            className: 'dshsm-tab',
            'aria-selected': view === 'discover' && detail === null,
            tabIndex: view === 'discover' && detail === null ? 0 : -1,
            onClick: () => { switchView('discover') },
          }, t('tab.discover')),
          h('button', {
            type: 'button',
            role: 'tab',
            ref: installedTab,
            className: 'dshsm-tab',
            'aria-selected': view === 'installed' && detail === null,
            tabIndex: view === 'installed' && detail === null ? 0 : -1,
            onClick: () => { switchView('installed') },
          }, t('tab.installed')),
        ),
      ),
      body,
      preview === null ? null : h(PreviewDialog, {
        t,
        state: preview,
        installing,
        onClose: closePreview,
        onRetry: () => {
          if (preview.entry !== null && preview.entry !== undefined && preview.entry.kind === 'local') {
            void openLocalPreview(preview.entry.path)
          } else {
            void openPreview(preview.entry)
          }
        },
        onInstall: () => { void confirmInstall() },
      }),
      sourcesOpen
        ? h(SourceDialog, {
          t,
          sources: { status: sources.status, items: sources.items, selected: sources.selected, error: sources.error },
          form: sourceForm,
          formError: sourceFormError,
          busy: sourceBusy,
          onClose: () => { if (!sourceBusy) setSourcesOpen(false) },
          onRetry: () => { void loadSources() },
          onFormChange: (next) => { setSourceForm(next); setSourceFormError(null) },
          onSubmit: submitSource,
          onSelect: (id) => { void selectSource(id, true) },
          onRemove: (id) => { void removeSource(id) },
        })
        : null,
      localOpen
        ? h(LocalInstallDialog, {
          t,
          path: localPath,
          error: localError,
          busy: localBusy,
          onClose: () => { if (!localBusy) setLocalOpen(false) },
          onChange: (value) => { setLocalPath(value); setLocalError(null) },
          onSubmit: submitLocal,
        })
        : null,
      toasts.length === 0 ? null : h('div', { className: 'dshsm-toasts', role: 'status', 'aria-live': 'polite' },
        toasts.map((toast) => h('div', {
          key: toast.id,
          className: 'dshsm-toast',
          'data-kind': toast.kind,
        },
        h('span', { className: 'dshsm-toastIcon' },
          toast.kind === 'success' ? h(CheckIcon) : h(AlertIcon, { size: 14 })),
        h('span', { className: 'dshsm-toastText' }, toast.message),
        )),
      ),
    )
  }
  MarketPage.displayName = 'SkillsMarketPage'
  return MarketPage
}
