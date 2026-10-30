/**
 * Host half of the Co-write bundle.
 *
 * The feature is a browser-only review drawer: it reads the loaded
 * conversation through the Client services and workspace files through the
 * existing `workspaceFiles` Remote, then writes the composed message through
 * the Session's own input or send path. No Host service is needed, but the
 * Loader row keeps the plugin toggleable in the Plugin Manager.
 */
export function apply() {}
