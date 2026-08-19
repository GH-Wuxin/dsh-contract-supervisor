// S5.2 — host-side CLI/cmdline seam.
//
// Wires the developer-only `contract-supervisor-run --spec <path>` subcommand
// through the GENUINE rc.6 cmdline mechanism (provideCmdline / parseCmdline
// from @deepseek-ai/dsh-cmdline) WITHOUT adding a second Cordis loader/plugin
// row. The seam is installed by the existing contract-supervisor plugin's
// apply(), conditionally: it only acts when the launcher provided cmdlineArgs
// (real `dsh --profile ...` invocations) AND the first internal arg is
// `contract-supervisor-run`. In a no-arg boot (e.g. the profile load smoke),
// cmdlineArgs is absent, so this seam is inert and the plugin simply provides
// its service as before.
//
// The seam is host-side and NOT model-visible: it parses the process's own
// command line before any session exists, never registers a model-facing tool,
// and never uses commands.register. The driver itself is a host-side function.
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';
import { runContractSupervisorDriver } from '../driver/run.js';
const SUBCOMMAND = 'contract-supervisor-run';
/**
 * Build the genuine commander program declaring the developer-only
 * `contract-supervisor-run` subcommand. The subcommand's action reads the spec
 * file, runs the host driver, and requests process exit through the launcher's
 * appExit. The action is async; its I/O defers the driver run past tree
 * settlement so the genuine AgentRegistry is active when the driver reaches it.
 */
function buildProgram(ctx) {
    const program = new Command();
    program.name('dsh');
    program.exitOverride();
    program
        .command(SUBCOMMAND)
        .description('Run the C5 contract supervisor Pro-commander driver against a RunSpec v1 file.')
        .requiredOption('--spec <path>', 'absolute path to the RunSpec v1 JSON file')
        .action(async (options) => {
        const exit = ctx.get('appExit');
        const fail = (message) => {
            const stderr = process.stderr;
            stderr.write(`dsh: contract-supervisor-run: ${message}\n`);
            if (typeof exit === 'function')
                exit(1);
            else
                process.exit(1);
        };
        try {
            const specText = await readFile(options.spec, 'utf8');
            let raw;
            try {
                raw = JSON.parse(specText);
            }
            catch {
                fail(`spec file is not valid JSON: ${options.spec}`);
                return;
            }
            const result = await runContractSupervisorDriver(ctx, raw);
            const stdout = process.stdout;
            stdout.write(`${JSON.stringify(result)}\n`);
            if (typeof exit === 'function')
                exit(result.exitCode);
            else
                process.exit(result.exitCode);
        }
        catch (error) {
            fail(`driver invocation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    return program;
}
/**
 * Inspect the booted context for a `contract-supervisor-run` invocation and, if
 * present, parse it through the genuine cmdline mechanism and run the driver.
 *
 * Returns true iff the cmdline was intended for this seam (the launcher
 * provided cmdlineArgs AND the first internal arg names our subcommand). In
 * that case parseCmdline has already dispatched the action; the caller should
 * not treat the boot as an ordinary long-lived surface.
 *
 * Returns false when cmdlineArgs is absent (no-arg boot / smoke) or the first
 * internal arg is not our subcommand; the plugin then simply provides its
 * service unchanged.
 */
export function maybeRunContractSupervisorCmdline(ctx) {
    const cmdlineArgs = ctx.get('cmdlineArgs');
    if (cmdlineArgs === undefined) {
        return false;
    }
    const args = cmdlineArgs.get();
    if (args.length === 0 || args[0] !== SUBCOMMAND) {
        return false;
    }
    // appExit is provided alongside cmdlineArgs by provideCmdline; guard anyway.
    const appExit = ctx.get('appExit');
    if (typeof appExit !== 'function') {
        return false;
    }
    const program = buildProgram(ctx);
    parseCmdline(ctx, program);
    return true;
}
//# sourceMappingURL=cmdline.js.map