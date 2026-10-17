# rap-plus

A [Pi](https://pi.dev) package — extensions, theme, and tooling for the RAP workflow.

> Install with one line:
>
> ```sh
> curl -fsSL https://raw.githubusercontent.com/rapelzzz/rap-plus/main/install.sh | sh
> ```

That installs Pi (if missing) and registers the `rap-plus` package. Start Pi and the extensions load automatically.

## What's inside

| Resource | Path | Description |
|---|---|---|
| bluemon studio | `extensions/rap-bluemon` | Neon studio UI: status bar, rain panel, usage analytics, trend chart |
| todo system | `extensions/todo` | RAP Todo panel, `/todo` commands, `rap_todo` tool, per-project persistence, widget renderer |
| web search | `extensions/rap-web-search.ts` | Headless Playwright + DuckDuckGo `web_search` tool |
| theme | `themes/rap-bluemon.json` | Dark "bluemon" theme |

## Manual install

```sh
pi install git:github.com/rapelzzz/rap-plus
```

Or pin a ref:

```sh
pi install git:github.com/rapelzzz/rap-plus@main
```

## Manage

```sh
pi list                       # show registered packages
pi update --extensions        # reconcile package checkouts
pi remove git:github.com/rapelzzz/rap-plus
pi config                     # toggle resources / enable the theme
```

## Develop locally

```sh
git clone https://github.com/rapelzzz/rap-plus
cd rap-plus
npm install
pi -e .                       # try the package for one session
```

Requires Node.js 22.19+ and Pi.
