/**
 * Host half of the wallpaper bundle.
 *
 * The bundle owns no Host service: the wallpaper is a browser-only painting, so
 * `client.js` installs the stylesheet and this entry only has to exist for the
 * Loader row. Keeping the row (rather than a patch-only bundle) lets the plugin
 * be toggled in the Plugin Manager like any other row.
 */
export function apply() {}
