# pi-calm-mode

A quieter display mode for the [Pi coding agent](https://pi.dev).

Calm mode hides model tool activity and internal reasoning while leaving the rest of Pi's interface unchanged.

## What it hides

- ordinary model tool calls, including pending and completed calls
- tool arguments, results, errors, diffs, and tool-returned images
- the `Tool output: expanded/collapsed` toggle status
- thinking and reasoning blocks

## What remains visible

- assistant text
- submitted user messages
- the startup header and resource list
- footer, editor, working indicator, statuses, warnings, and notifications
- custom extension messages, entries, and widgets
- subagent runs, results, waits, and intercom/control activity
- skill, compaction, and branch-summary messages
- user-invoked `!` / `!!` bash commands and their output
- explicit selectors, confirmation dialogs, and overlays

Calm mode changes presentation only. Tools still execute normally, results still reach the model, and the full conversation remains in session context and session files.

## Install from this folder

From the repository root:

```bash
pi install .
```

Then restart Pi or run `/reload`.

Local packages are referenced in place, so edits to this folder take effect after `/reload`.

To disable calm mode, use `pi config`, or run this from the repository root:

```bash
pi remove .
```

## Load order

Keep calm mode after renderer packages such as `pi-tool-display` in `settings.json` so its hidden tool-row renderer wins display conflicts.

## Compatibility

Tested against Pi `0.83.x`.

Pi does not currently expose public hooks for globally hiding tool rows or filtering reasoning from built-in assistant messages. Calm mode therefore uses reload-safe prototype patches against Pi's exported `ToolExecutionComponent` and `AssistantMessageComponent`. A future Pi release may require an update.

## Development

```bash
npm install
npm run check
```

## License

MIT © Gabriel Lundgren
