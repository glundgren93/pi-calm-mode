# pi-calm-mode

A quieter display mode for the [Pi coding agent](https://pi.dev).

Calm mode hides model tool activity and internal reasoning, frames assistant replies in clear response boxes, and leaves the rest of Pi's interface unchanged.

## What it hides

- ordinary model tool calls, including pending and completed calls
- tool arguments, results, errors, diffs, and tool-returned images
- the `Tool output: expanded/collapsed` toggle status
- thinking and reasoning blocks

## What remains visible

- assistant text in an `assistant`-labelled response box
- submitted user messages
- the startup header and resource list
- footer, editor, working indicator, statuses, warnings, and notifications
- custom extension messages, entries, and widgets
- subagent runs, results, waits, and intercom/control activity
- skill, compaction, and branch-summary messages
- user-invoked `!` / `!!` bash commands and their output
- explicit selectors, confirmation dialogs, and overlays

Calm mode changes presentation only. Tools still execute normally, results still reach the model, and the full conversation remains in session context and session files.

Historical or interrupted assistant turns containing only hidden activity render a neutral `Activity hidden` response box instead of leaving an ambiguous gap between user messages. Subagent-only turns rely on their visible subagent row and do not add this placeholder.

## Install

Install directly from GitHub—no manual clone is required:

```bash
pi install git:github.com/glundgren93/pi-calm-mode
```

Then restart Pi or run `/reload`.

To try calm mode for one Pi run without installing it:

```bash
pi -e git:github.com/glundgren93/pi-calm-mode
```

Update installed Git packages with:

```bash
pi update --extensions
```

To disable calm mode, use `pi config`, or remove the package:

```bash
pi remove git:github.com/glundgren93/pi-calm-mode
```

## Load order

Keep calm mode after renderer packages such as `pi-tool-display` in `settings.json` so its hidden tool-row renderer wins display conflicts.

## Compatibility

Tested against Pi `0.83.x`.

Pi does not currently expose public hooks for globally hiding tool rows or filtering reasoning from built-in assistant messages. Calm mode therefore uses reload-safe prototype patches against Pi's exported `ToolExecutionComponent` and `AssistantMessageComponent`. A future Pi release may require an update.

## Development

From a local checkout:

```bash
npm install
npm run check
pi install .
```

Local packages are referenced in place, so edits take effect after `/reload`.

## License

MIT © Gabriel Lundgren
