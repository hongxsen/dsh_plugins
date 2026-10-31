/**
 * Pure builders that turn a normalized registry entry plus user values into a
 * valid `@deepseek-ai/dsh-mcp-client` configuration.
 *
 * Nothing here reads the network, the filesystem, or a DSH context. The route
 * layer re-fetches the entry, calls these builders, and writes the result; the
 * browser's values are validated here before they can reach a profile patch.
 */
import { mcpError, isPlainObject } from './errors.js'
import { serverNameFor } from './slug.js'

/** Upper bound for one header or environment value, as UTF-8 bytes. */
export const MAX_VALUE_BYTES = 8 * 1024

/** Runtime command for each supported package registry. */
export const PACKAGE_RUNTIME = Object.freeze({ npm: 'npx', pypi: 'uvx', oci: 'docker' })

/** Only stdio packages are supported by this install pipeline. */
export const STDIO_TRANSPORT = 'stdio'

/** A conservative version check: concrete versions only, never ranges. */
const CONCRETE_VERSION = /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/u

/** A safe HTTP header name (RFC token). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

/** A safe environment variable name. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** A command-line flag. */
const FLAG_NAME = /^--?[A-Za-z0-9][A-Za-z0-9_.:-]*$/u

/** Placeholder syntax used by registry templates. */
const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/gu

/** Keys that must never become own properties of a config map. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** True for a map key that could mutate an object prototype. */
function unsafeKey(name) {
  return typeof name !== 'string' || UNSAFE_KEYS.has(name)
}

/** True when a name looks like a credential, used to default redaction and password fields. */
export function isSecretName(name) {
  if (typeof name !== 'string') return false
  const normalized = name.toLowerCase()
  return /(?:^|[-_.])(?:token|secret|password|passwd|credential|key)s?(?:$|[-_.])/u.test(normalized)
    || /authorization|bearer|api[-_]?key|apikey|private[-_]?key|access[-_]?key/u.test(normalized)
}

/** Throw the documented invalid-value failure. */
function invalidValue(message, details = undefined) {
  return mcpError('invalid-value', message, 400, details)
}

/** Throw the documented needs-input failure. */
function missingInput(missing) {
  return mcpError('needs-input', 'Required configuration values are missing.', 400, { missing })
}

/** Byte length of a string, using UTF-8. */
function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

/** Check a user-provided value map and return a safe copy. */
function normalizeValueMap(raw, field) {
  if (raw === undefined || raw === null) return {}
  if (!isPlainObject(raw)) throw invalidValue(`The ${field} values must be an object.`)
  const output = {}
  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw invalidValue('The submitted value map contains a forbidden key.')
    }
    if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
      throw invalidValue('A submitted key is malformed.')
    }
    const value = raw[key]
    if (typeof value !== 'string') throw invalidValue(`The value for "${key}" must be a string.`)
    if (byteLength(value) > MAX_VALUE_BYTES) {
      throw mcpError('invalid-value', `The value for "${key}" is too large.`, 400, { maxBytes: MAX_VALUE_BYTES })
    }
    if (value.includes('\u0000')) throw invalidValue(`The value for "${key}" contains a NUL character.`)
    if (field === 'headers' && /[\r\n]/u.test(value)) {
      throw invalidValue(`The header value for "${key}" contains a line break.`)
    }
    output[key] = value
  }
  return output
}

/**
 * Validate the install body's `values` map.
 *
 * @returns `{ headers, env }` with only string values no larger than 8 KiB.
 */
export function normalizeValues(values = undefined) {
  if (values === undefined || values === null) return { headers: {}, env: {} }
  if (!isPlainObject(values)) throw invalidValue('The install values must be an object.')
  return {
    headers: normalizeValueMap(values.headers, 'headers'),
    env: normalizeValueMap(values.env, 'env'),
  }
}

/**
 * Resolve `{key}` placeholders from a registry variables declaration.
 *
 * @returns the partially resolved value and the keys that still need input.
 */
export function resolveTemplate(template, variables) {
  if (typeof template !== 'string' || template.length === 0) return { value: '', unresolved: [] }
  const unresolved = []
  const value = template.replace(PLACEHOLDER, (match, key) => {
    const variable = isPlainObject(variables) ? variables[key] : undefined
    if (isPlainObject(variable) && typeof variable.default === 'string' && variable.default.length > 0) return variable.default
    unresolved.push(key)
    return match
  })
  return { value, unresolved: [...new Set(unresolved)] }
}

/** Validate an HTTP(S) endpoint without credentials. */
export function assertHttpUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw mcpError('invalid-entry', 'The server endpoint is not a valid URL.', 400)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw mcpError('invalid-entry', 'The server endpoint must use HTTP or HTTPS.', 400)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw mcpError('invalid-entry', 'The server endpoint must not embed credentials.', 400)
  }
  if (value.length > 4096) throw mcpError('invalid-entry', 'The server endpoint is too long.', 400)
  return value
}

/** True when a concrete package version should be pinned in the command. */
export function isConcreteVersion(version) {
  return typeof version === 'string' && CONCRETE_VERSION.test(version)
}

/** Describe one header declaration after resolving variable defaults. */
function describeHeader(header) {
  const template = typeof header.value === 'string' && header.value.length > 0
  const resolved = template ? resolveTemplate(header.value, header.variables) : { value: '', unresolved: [] }
  const literal = template && resolved.unresolved.length === 0
  const unresolved = resolved.unresolved
  return {
    header,
    template,
    literal,
    literalValue: literal ? resolved.value : undefined,
    resolvedValue: resolved.value,
    unresolved,
    required: header.isRequired === true || unresolved.length > 0,
    secret: header.isSecret === true
      || isSecretName(header.name)
      || unresolved.some(key => isPlainObject(header.variables?.[key]) && header.variables[key].isSecret === true),
  }
}

/**
 * Public header fields that need a value from the install form.
 * @returns `{ name, description, required, secret }[]`.
 */
export function headerFields(remote) {
  const fields = []
  for (const header of remote.headers ?? []) {
    const described = describeHeader(header)
    if (described.literal) continue
    fields.push({
      name: header.name,
      description: header.description ?? '',
      required: described.required,
      secret: described.secret,
    })
  }
  return fields
}

/** Read a user value for one header, accepting the header name or a placeholder key. */
function headerValue(values, described) {
  const direct = values.headers[described.header.name]
  if (typeof direct === 'string' && direct.length > 0) return direct
  for (const key of described.unresolved) {
    const candidate = values.headers[key]
    if (typeof candidate === 'string') return candidate
  }
  return ''
}

/** Fill unresolved placeholders with the user's value. */
function fillHeaderTemplate(described, supplied) {
  let value = described.resolvedValue
  for (const key of described.unresolved) {
    value = value.replaceAll(`{${key}}`, () => supplied)
  }
  return value
}

/** Validate one final header name and value. */
function assertHeader(name, value) {
  if (typeof name !== 'string' || unsafeKey(name) || !HEADER_NAME.test(name)) {
    throw invalidValue(`The header name "${name}" is invalid.`)
  }
  if (typeof value !== 'string' || byteLength(value) > MAX_VALUE_BYTES || /[\r\n\u0000]/u.test(value)) {
    throw invalidValue(`The header value for "${name}" is invalid.`)
  }
}

/**
 * Build a streamable-http client config.
 *
 * @param entry - normalized registry entry (used for the stable server name).
 * @param remote - normalized remote.
 * @param values - normalized `{ headers, env }`.
 * @returns `{ config, headers, secretKeys, warnings }`.
 */
export function buildRemoteConfig(entry, remote, values) {
  const urlInfo = resolveTemplate(remote.url, remote.variables)
  if (urlInfo.unresolved.length > 0) {
    throw missingInput(urlInfo.unresolved.map(key => ({ kind: 'url', name: key })))
  }
  const url = assertHttpUrl(urlInfo.value)
  const headers = {}
  const secretKeys = new Set()
  const missing = []

  for (const header of remote.headers ?? []) {
    const described = describeHeader(header)
    if (described.secret) secretKeys.add(header.name)
    if (described.literal) {
      assertHeader(header.name, described.literalValue)
      headers[header.name] = described.literalValue
      continue
    }
    const supplied = headerValue(values, described)
    if (supplied.trim().length === 0) {
      if (described.required) missing.push({ kind: 'header', name: header.name })
      continue
    }
    const final = described.template ? fillHeaderTemplate(described, supplied) : supplied
    assertHeader(header.name, final)
    headers[header.name] = final
  }

  if (missing.length > 0) throw missingInput(missing)

  const config = {
    serverName: serverNameFor(entry.name),
    transport: 'streamable-http',
    url,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  }
  const warnings = []
  if (/^http:\/\//iu.test(url)) warnings.push('insecure-url')
  if (secretKeys.size > 0) warnings.push('secret-in-profile')
  return { config, headers, secretKeys: [...secretKeys], warnings }
}

/**
 * Public environment fields for a package.
 * @returns `{ name, description, required, secret, hasDefault }[]`.
 */
export function environmentFields(pkg) {
  return (pkg.environmentVariables ?? []).map(variable => ({
    name: variable.name,
    description: variable.description ?? '',
    required: variable.isRequired === true,
    secret: variable.isSecret === true || isSecretName(variable.name),
    hasDefault: typeof variable.default === 'string' && variable.default.length > 0,
  }))
}

/** Normalize a flag declaration into one CLI token. */
function normalizeFlag(name) {
  if (typeof name !== 'string' || name.length === 0) return null
  const flag = name.startsWith('-') ? name : `--${name}`
  return FLAG_NAME.test(flag) ? flag : null
}

/** Build package argument tokens, collecting the required ones that have no value. */
function buildArgumentTokens(args, seenFlags, missing) {
  const tokens = []
  for (const arg of args ?? []) {
    const raw = typeof arg.value === 'string' ? arg.value : typeof arg.default === 'string' ? arg.default : ''
    const resolved = resolveTemplate(raw, arg.variables)
    if (resolved.unresolved.length > 0) {
      for (const key of resolved.unresolved) missing.push({ kind: 'argument', name: key })
      continue
    }
    const value = resolved.value
    if (arg.type === 'named') {
      const flag = normalizeFlag(arg.name)
      if (flag === null) throw mcpError('invalid-entry', 'The package declares an invalid argument flag.', 400)
      if (seenFlags.has(flag)) continue
      if (value.length === 0) {
        if (arg.isRequired) missing.push({ kind: 'argument', name: flag })
        continue
      }
      tokens.push(flag, value)
      seenFlags.add(flag)
    } else {
      if (value.length === 0) {
        if (arg.isRequired) missing.push({ kind: 'argument', name: arg.valueHint ?? arg.name ?? 'positional' })
        continue
      }
      tokens.push(value)
    }
  }
  return tokens
}

/** Append a pinned version to an npm package name. */
function npmTarget(identifier, version) {
  if (!isConcreteVersion(version)) return identifier
  // A scoped name starts with '@'; a second '@' means the version is already pinned.
  if (identifier.indexOf('@', 1) !== -1) return identifier
  return `${identifier}@${version}`
}

/** Append a pinned version to a Python package name. */
function pypiTarget(identifier, version) {
  if (!isConcreteVersion(version)) return identifier
  if (identifier.includes('==') || identifier.includes('@')) return identifier
  return `${identifier}==${version}`
}

/** Append a tag to an OCI image reference unless one is already present. */
function ociTarget(identifier, version) {
  if (!isConcreteVersion(version)) return identifier
  if (identifier.includes('@sha256:')) return identifier
  const last = identifier.split('/').at(-1) ?? ''
  if (last.includes(':')) return identifier
  return `${identifier}:${version}`
}

/** Build the runtime command and complete argument list for one package. */
export function buildPackageCommand(pkg, { strict = true } = {}) {
  const command = PACKAGE_RUNTIME[pkg.registryType]
  if (command === undefined) throw mcpError('invalid-entry', 'This package registry is not supported.', 400)
  const seenFlags = new Set()
  const missing = []
  const runtime = buildArgumentTokens(pkg.runtimeArguments, seenFlags, missing)
  const packageArgs = buildArgumentTokens(pkg.packageArguments, seenFlags, missing)
  const target = pkg.registryType === 'npm'
    ? npmTarget(pkg.identifier, pkg.version)
    : pkg.registryType === 'pypi'
      ? pypiTarget(pkg.identifier, pkg.version)
      : ociTarget(pkg.identifier, pkg.version)

  if (command === 'npx' && !runtime.includes('-y') && !runtime.includes('--yes')) runtime.unshift('-y')
  let dockerRuntime = runtime
  if (command === 'docker') {
    const interactive = runtime.includes('-i') || runtime.includes('--interactive')
    const removeContainer = runtime.includes('--rm')
    const runIndex = runtime.indexOf('run')
    if (runIndex >= 0) {
      const head = runtime.slice(0, runIndex + 1)
      const tail = runtime.slice(runIndex + 1).filter(token => !['-i', '--interactive', '--rm'].includes(token))
      dockerRuntime = [...head, ...(interactive ? [] : ['-i']), ...(removeContainer ? [] : ['--rm']), ...tail]
    } else {
      const extras = runtime.filter(token => !['-i', '--interactive', '--rm'].includes(token))
      dockerRuntime = ['run', ...(interactive ? [] : ['-i']), ...(removeContainer ? [] : ['--rm']), ...extras]
    }
  }

  const args = [...dockerRuntime, target, ...packageArgs]
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length === 0 || arg.length > MAX_VALUE_BYTES || arg.includes('\u0000')) {
      throw mcpError('invalid-entry', 'The package command contains an invalid argument.', 400)
    }
  }
  if (strict && missing.length > 0) throw missingInput(missing)
  return { command, target, args, missing }
}

/**
 * Build a stdio client config for an npm, PyPI, or OCI package.
 *
 * @returns `{ config, env, secretKeys, warnings }`.
 */
export function buildPackageConfig(entry, pkg, values) {
  if (!isPlainObject(pkg.transport) || pkg.transport.type !== STDIO_TRANSPORT) {
    throw mcpError('invalid-entry', 'This package does not expose a stdio transport.', 400)
  }
  const built = buildPackageCommand(pkg, { strict: true })
  const env = {}
  const secretKeys = new Set()
  const missing = []
  for (const variable of pkg.environmentVariables ?? []) {
    if (typeof variable.name !== 'string' || unsafeKey(variable.name) || !ENV_NAME.test(variable.name)) {
      throw mcpError('invalid-entry', 'The package declares an invalid environment variable.', 400)
    }
    const supplied = values.env[variable.name]
    const fallback = typeof variable.default === 'string' ? variable.default : ''
    const value = typeof supplied === 'string' && supplied.length > 0 ? supplied : fallback
    const secret = variable.isSecret === true || isSecretName(variable.name)
    if (secret) secretKeys.add(variable.name)
    if (value.length === 0) {
      if (variable.isRequired) missing.push({ kind: 'env', name: variable.name })
      continue
    }
    if (byteLength(value) > MAX_VALUE_BYTES || value.includes('\u0000')) {
      throw invalidValue(`The environment value for "${variable.name}" is invalid.`)
    }
    env[variable.name] = value
  }
  if (missing.length > 0) throw missingInput(missing)

  const config = {
    serverName: serverNameFor(entry.name),
    transport: 'stdio',
    command: built.command,
    args: built.args,
    ...(Object.keys(env).length === 0 ? {} : { env }),
  }
  const warnings = []
  if (!isConcreteVersion(pkg.version)) warnings.push('unpinned-version')
  if (secretKeys.size > 0) warnings.push('secret-in-profile')
  return { config, env, secretKeys: [...secretKeys], warnings, command: built.command }
}

/**
 * Validate and build one install choice.
 *
 * @param entry - normalized registry entry.
 * @param choice - `{ kind, index }` from the install body.
 * @param values - normalized user values.
 * @returns the config plus metadata used by the route layer.
 */
export function buildChoice(entry, choice, values) {
  if (!isPlainObject(choice)) throw mcpError('invalid-entry', 'Choose a remote or package to install.', 400)
  if (choice.kind === 'remote') {
    if (!Number.isInteger(choice.index) || choice.index < 0 || choice.index >= entry.remotes.length) {
      throw mcpError('invalid-entry', 'The selected remote does not exist.', 400)
    }
    const remote = entry.remotes[choice.index]
    const built = buildRemoteConfig(entry, remote, values)
    return { kind: 'remote', index: choice.index, transport: 'streamable-http', url: remote.url, ...built }
  }
  if (choice.kind === 'package') {
    if (!Number.isInteger(choice.index) || choice.index < 0 || choice.index >= entry.packages.length) {
      throw mcpError('invalid-entry', 'The selected package does not exist.', 400)
    }
    const pkg = entry.packages[choice.index]
    const built = buildPackageConfig(entry, pkg, values)
    return { kind: 'package', index: choice.index, transport: 'stdio', ...built }
  }
  throw mcpError('invalid-entry', 'The install choice kind is invalid.', 400)
}

/** Redact secret header and environment values before they cross to the browser. */
export function redactConfig(config, secretKeys = []) {
  const secrets = new Set(secretKeys)
  const clone = { ...config }
  if (isPlainObject(config.headers)) {
    clone.headers = Object.fromEntries(Object.entries(config.headers).map(([name, value]) => [
      name,
      secrets.has(name) || isSecretName(name) ? '••••••' : value,
    ]))
  }
  if (isPlainObject(config.env)) {
    clone.env = Object.fromEntries(Object.entries(config.env).map(([name, value]) => [
      name,
      secrets.has(name) || isSecretName(name) ? '••••••' : value,
    ]))
  }
  if (Array.isArray(config.args)) clone.args = [...config.args]
  return clone
}

/** Preview config for a remote: literal headers stay visible, inputs become dots. */
function previewRemote(entry, remote, runtimes) {
  const urlInfo = resolveTemplate(remote.url, remote.variables)
  const headers = {}
  const secretKeys = new Set()
  const fields = headerFields(remote)
  for (const header of remote.headers ?? []) {
    if (unsafeKey(header.name)) continue
    const described = describeHeader(header)
    if (described.secret) secretKeys.add(header.name)
    if (described.literal) headers[header.name] = described.literalValue
    else if (described.required) headers[header.name] = '••••••'
  }
  const config = {
    serverName: serverNameFor(entry.name),
    transport: 'streamable-http',
    url: urlInfo.value,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  }
  const warnings = []
  if (/^http:\/\//iu.test(urlInfo.value)) warnings.push('insecure-url')
  if (secretKeys.size > 0) warnings.push('secret-in-profile')
  return {
    kind: 'remote',
    index: entry.remotes.indexOf(remote),
    transport: 'streamable-http',
    url: urlInfo.value,
    headers: fields,
    env: [],
    available: true,
    blocked: urlInfo.unresolved.map(key => ({ kind: 'url', name: key })),
    warnings,
    config: redactConfig(config, [...secretKeys]),
    secretKeys: [...secretKeys],
  }
}

/** Preview config for a package. */
function previewPackage(entry, pkg, runtimes) {
  const command = PACKAGE_RUNTIME[pkg.registryType]
  const fields = environmentFields(pkg)
  const secretKeys = fields.filter(field => field.secret).map(field => field.name)
  let built
  try {
    built = buildPackageCommand(pkg, { strict: false })
  } catch {
    built = { command, target: pkg.identifier, args: [], missing: [{ kind: 'argument', name: 'package' }] }
  }
  const env = {}
  for (const field of fields) {
    if (unsafeKey(field.name)) continue
    if (field.secret) env[field.name] = '••••••'
    else if (field.hasDefault) {
      const declared = pkg.environmentVariables.find(variable => variable.name === field.name)
      if (typeof declared?.default === 'string') env[field.name] = declared.default
    }
  }
  const config = {
    serverName: serverNameFor(entry.name),
    transport: 'stdio',
    command,
    args: built.args,
    ...(Object.keys(env).length === 0 ? {} : { env }),
  }
  const warnings = []
  if (!isConcreteVersion(pkg.version)) warnings.push('unpinned-version')
  if (secretKeys.length > 0) warnings.push('secret-in-profile')
  const available = runtimes?.[command] !== false
  if (!available) warnings.push('runtime-missing')
  return {
    kind: 'package',
    index: entry.packages.indexOf(pkg),
    transport: 'stdio',
    command,
    args: built.args,
    identifier: pkg.identifier,
    version: pkg.version,
    headers: [],
    env: fields,
    available,
    runtimeMissing: !available,
    blocked: built.missing,
    warnings,
    config: redactConfig(config, secretKeys),
    secretKeys,
  }
}

/**
 * Build the default preview for a registry entry.
 *
 * @param entry - normalized registry entry.
 * @param runtimes - map of `{ npx, uvx, docker }` availability.
 * @param existing - whether the same server name is already managed.
 * @returns the documented preview object plus per-choice details for the form.
 */
export function previewServer(entry, runtimes = {}, existing = false) {
  const choices = [
    ...entry.remotes.map(remote => previewRemote(entry, remote, runtimes)),
    ...entry.packages.filter(pkg => pkg?.transport?.type === STDIO_TRANSPORT).map(pkg => previewPackage(entry, pkg, runtimes)),
  ]
  const preferred = choices.find(choice => choice.kind === 'remote' && choice.blocked.length === 0)
    ?? choices.find(choice => choice.available && choice.blocked.length === 0)
    ?? choices[0]
    ?? null
  const warnings = [...new Set(preferred?.warnings ?? [])]
  if (choices.length === 0) warnings.push('unsupported')
  return {
    kind: preferred?.kind ?? null,
    index: preferred?.index ?? null,
    rowId: `mcp-market-${serverNameFor(entry.name)}`,
    serverName: serverNameFor(entry.name),
    title: entry.title,
    transport: preferred?.transport ?? null,
    ...(preferred?.url === undefined ? {} : { url: preferred.url }),
    ...(preferred?.command === undefined ? {} : { command: preferred.command }),
    ...(preferred?.args === undefined ? {} : { args: preferred.args }),
    headers: preferred?.headers ?? [],
    env: preferred?.env ?? [],
    warnings,
    blocked: preferred?.blocked ?? [],
    runtimeMissing: preferred?.runtimeMissing === true,
    existing,
    choices,
    config: preferred?.config ?? null,
    runtimes,
  }
}

/** Convert a stored managed record back into a patch row. */
export function rowFromRecord(record) {
  const row = {
    rowId: record.rowId,
    serverName: record.serverName,
    transport: record.transport,
  }
  if (record.transport === 'streamable-http') {
    row.url = record.url
    if (isPlainObject(record.headers)) row.headers = { ...record.headers }
  } else {
    row.command = record.command
    row.args = Array.isArray(record.args) ? [...record.args] : []
    if (isPlainObject(record.env)) row.env = { ...record.env }
  }
  return row
}

/** Build a store record for a successful install. */
export function recordFromChoice(entry, built, timestamps) {
  const record = {
    rowId: `mcp-market-${built.config.serverName}`,
    serverName: built.config.serverName,
    registryName: entry.name,
    title: entry.title,
    description: entry.description,
    version: entry.version,
    transport: built.transport,
    enabled: true,
    installedAt: timestamps.installedAt,
    updatedAt: timestamps.updatedAt,
  }
  if (built.transport === 'streamable-http') {
    record.url = built.config.url
    if (isPlainObject(built.config.headers)) record.headers = { ...built.config.headers }
  } else {
    record.command = built.config.command
    record.args = [...built.config.args]
    if (isPlainObject(built.config.env)) record.env = { ...built.config.env }
  }
  return record
}
