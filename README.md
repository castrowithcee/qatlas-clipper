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
