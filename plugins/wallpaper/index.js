/**
 * Host half of the wallpaper bundle.
 *
 * The bundle owns no Host service: the wallpaper, its picker, and the custom
 * image live entirely in the browser, so `client.js` installs the stylesheet
 * and registers the settings section while this entry only exists for the
 * Loader row. Keeping the row (rather than a patch-only bundle) lets the
 * plugin be toggled in the Plugin Manager like any other row.
 */
export function apply() {}
