# qatlas-clipper

Browser extension for Chromium-based browsers (Chrome, Brave, Edge) that reads content and fields from the
current web page according to configurable projects and sends them to your own webhooks, for example n8n.

Data goes only to the webhooks you configure. Nothing is sent anywhere else.

## License

MIT, see [LICENSE](LICENSE).

## Development

Requires Node 22 and npm.

```sh
npm ci
```

Commands:

- `npm run dev`: development build with reload
- `npm run build`: production build to `.output/chrome-mv3`
- `npm run zip`: package the build as a zip
- `npm test`: unit tests (Vitest)
- `npm run typecheck`: TypeScript check
- `npm run lint`: ESLint

Load the unpacked extension in Chromium: open `chrome://extensions`, enable Developer mode, choose "Load unpacked" and select `.output/chrome-mv3`.

## Configuration

A project is chosen by its triggers: URL prefix, regular expression or schema.org type (from JSON-LD). The first matching project in list order wins.

Each field is resolved from these sources in fixed order; the first non-empty value wins:

1. schema.org path
2. meta tag (`name` or `property`)
3. site-mapping selector (CSS selector per domain)
4. manual input

A schema.org path has the form `Type.property.property`, for example `Article.author.name`. For arrays the first non-empty value is used; an object that ends the path yields its `name`.
