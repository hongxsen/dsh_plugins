/**
 * Wallpaper for the DSH Web UI — client half.
 *
 * GENERATED FILE. Edit `client.template.js` (and `build.mjs` for the artwork),
 * then run `node build.mjs`. The two `data:` URIs below are produced from
 * `art/light.svg` and `art/dark.svg`.
 *
 * How it works
 * ------------
 * The shell paints the page on two levels: `body` carries
 * `background-color: var(--dsw-alias-bg-base)`, and the frame plus the main
 * column repaint `--dsw-alias-bg-base` on top of it. So a wallpaper alone would
 * stay invisible. This plugin therefore does two things, both through CSS
 * variables instead of hashed class names, so it survives UI rebuilds:
 *
 *   1. paints the artwork on `body` (cover, fixed, one per colour scheme);
 *   2. redefines `--dsw-alias-bg-base` as a translucent tint of the same
 *      surface colour, so every surface that repaints it becomes frosted glass
 *      over the artwork instead of an opaque sheet.
 *
 * Menus, tooltips and toasts keep their own `--dsw-specific-*` / `--dsw-alias-toast`
 * tokens, so they stay fully opaque and readable.
 *
 * Everything is registered inside `apply` through `ctx.effect`, so disabling the
 * plugin or hot-reloading it removes the stylesheet again.
 */

const ART = {
  light: '@@LIGHT@@',
  dark: '@@DARK@@',
}

const CSS = `
/* ---- wallpaper ------------------------------------------------------- */
body {
  --dsh-wallpaper-image: url("${ART.light}");
  --dsh-wallpaper-surface: #ffffff;
  --dsh-wallpaper-veil: 52%;
  background-color: #f7f9fc !important;
  background-image: var(--dsh-wallpaper-image) !important;
  background-position: center center !important;
  background-size: cover !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
  /* Frost the surfaces that repaint the document background. */
  --dsw-alias-bg-base: color-mix(in srgb, var(--dsh-wallpaper-surface) var(--dsh-wallpaper-veil), transparent) !important;
}

body[data-ds-dark-theme] {
  --dsh-wallpaper-image: url("${ART.dark}");
  --dsh-wallpaper-surface: #0f1319;
  background-color: #0b0e14 !important;
}

/* Respect an explicit request for less transparency: the wallpaper stays, the
   surfaces become nearly opaque so text contrast is unaffected. */
@media (prefers-reduced-transparency: reduce) {
  body {
    --dsh-wallpaper-veil: 92%;
  }
}
`

window.__ModuleLoader__.load({
  id: '@hongxsen/dsh-wallpaper',
  factory() {
    return {
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = '@hongxsen/dsh-wallpaper'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        })
      },
    }
  },
})
