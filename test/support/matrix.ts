/**
 * Coverage matrix contract.
 *
 * `PROXIED_COMMANDS` is public surface: installing a wrapper for a command is a
 * promise that running it through the proxy is worth the ~40 ms of node startup
 * it costs. This matrix is where that promise is checked - one realistic
 * invocation per command, with the reduction it must actually achieve.
 *
 * A command that cannot meet a threshold does not get a lower threshold: it
 * gets `passthroughReason`, which says out loud that the wrapper exists for
 * safety (guarding a machine format, or a hazard) rather than for savings.
 * Either way the claim is explicit and tested.
 */
export interface MatrixEntry {
  /** The proxied command, exactly as it appears in PROXIED_COMMANDS. */
  cmd: string
  /** Args as the agent would type them; args[0] is usually the subcommand. */
  args?: string[]
  /** One line: which real invocation this is, so a failure is diagnosable. */
  what: string
  /** Realistic raw stdout from the real tool. */
  input: string
  /**
   * Minimum percentage of characters this invocation must remove, 0-100.
   * Set from a measured value with headroom, never aspirationally.
   */
  minReduction: number
  /**
   * Set INSTEAD of a reduction when the wrapper earns its place by protecting
   * the output rather than shrinking it (a machine format, a pipe hazard, a
   * stream). Explain which, in a sentence. `minReduction` must then be 0.
   */
  passthroughReason?: string
}
