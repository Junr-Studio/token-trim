// token-trim - compress the output of shell commands your agent runs, to cut
// the tokens they cost in its context window.
//
// Two layers:
//   - createCommandProxy() - one-call ergonomic setup (recommended).
//   - writeProxyScripts()  - low-level script generation, if you wire the env yourself.
// Stats helpers live under the "@junr_studio/token-trim/stats" subpath too.

export { createCommandProxy } from './command-proxy.js'
export type { CommandProxy, CommandProxyOptions } from './command-proxy.js'

export { writeProxyScripts, PROXIED_COMMANDS } from './write-proxy.js'
export type { ProxyWriterOptions, ProxyScriptPaths } from './write-proxy.js'

export {
  parseSavingsFrame,
  createStatsReceiver,
  defaultStatsSocketPath,
  bytesToTokens,
  formatTokens,
  createSavingsAccumulator,
} from './stats.js'
export type {
  SavingsFrame,
  StatsReceiver,
  StatsReceiverOptions,
  SavingsTotals,
  SavingsAccumulator,
} from './stats.js'
