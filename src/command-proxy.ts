import { writeProxyScripts, type ProxyWriterOptions, type ProxyScriptPaths } from './write-proxy.js'
import { createStatsReceiver, type SavingsFrame, type StatsReceiver } from './stats.js'

export interface CommandProxyOptions extends ProxyWriterOptions {
  /** Directory to write proxy.mjs, the bin/ wrappers and setup.sh into. */
  dir: string
  /**
   * If provided, a stats socket is started and each byte-savings frame is
   * delivered here. Omit it to skip stats entirely (no socket is created).
   */
  onSavings?: (frame: SavingsFrame) => void
  /** Explicit stats socket path. Ignored unless `onSavings` is set. */
  socketPath?: string
}

export interface CommandProxy {
  /** Directory of the wrapper scripts (prepended to PATH by {@link CommandProxy.env}). */
  binDir: string
  /** setup.sh path (wired into BASH_ENV by {@link CommandProxy.env}). */
  setupScript: string
  /** Stats socket path, or `null` when `onSavings` was not provided. */
  socketPath: string | null
  /**
   * Merge the proxy's PATH/BASH_ENV and env-var contract into a base env,
   * returning a new env object to pass as `spawn(..., { env })`.
   */
  env(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** Stop the stats receiver (if any). Wrapper files are left on disk. */
  close(): Promise<void>
}

/**
 * One-call setup: write the proxy scripts, optionally start a stats receiver,
 * and hand back an `env()` helper to inject into any child process you spawn.
 *
 * ```ts
 * const proxy = await createCommandProxy({ dir, onSavings: f => log(f) })
 * spawn('claude', args, { env: proxy.env(process.env) })
 * // …later
 * await proxy.close()
 * ```
 */
export async function createCommandProxy(options: CommandProxyOptions): Promise<CommandProxy> {
  const { dir, onSavings, socketPath: explicitSocket, ...writerOptions } = options

  let receiver: StatsReceiver | null = null
  if (onSavings) {
    const receiverOptions: Parameters<typeof createStatsReceiver>[0] =
      explicitSocket !== undefined ? { socketPath: explicitSocket, onFrame: onSavings } : { onFrame: onSavings }
    receiver = await createStatsReceiver(receiverOptions)
  }

  const paths: ProxyScriptPaths = await writeProxyScripts(dir, writerOptions)
  const sep = process.platform === 'win32' ? ';' : ':'

  return {
    binDir: paths.binDir,
    setupScript: paths.setupScript,
    socketPath: receiver?.socketPath ?? null,

    env(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
      const merged: NodeJS.ProcessEnv = { ...base }
      // PATH is case-insensitive on Windows; reuse the caller's existing key
      // so we don't create a duplicate (e.g. both "Path" and "PATH").
      const pathKey = Object.keys(base).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
      merged[pathKey] = `${paths.binDir}${sep}${base[pathKey] ?? ''}`
      merged.BASH_ENV = paths.setupScript
      merged[paths.binDirEnvVar] = paths.binDir
      if (receiver) merged[paths.statsSocketEnvVar] = receiver.socketPath
      return merged
    },

    async close() {
      receiver?.close()
    },
  }
}
