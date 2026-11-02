# Webhook contract

qatlas-clipper sends one HTTP request per click on a send button to the URL of the chosen target. Targets are configured in the options page; the request goes only to that URL.

## Request

- Method: `POST`
- URL: the target URL (`https`, or `http` for localhost only). Redirects are not followed (a redirect counts as a network error). No cookies or other credentials are sent.
- Headers: `Content-Type: application/json` plus the access key of this target as `Authorization: Bearer <key>` and the custom headers configured for it (name and value as entered in the options page). Access keys and header values are sent only to their own target. A configured header named `Content-Type` is ignored.
- Body: one JSON object with exactly these keys:

| Key | Type | Meaning |
| --- | --- | --- |
| `project` | object `{ id, name }` | Project the data was read with (stable id and display name, strings). |
| `target` | object `{ id, name }` | The target this request is for (stable id and display name, strings). |
| `url` | string | Address of the page that was read. |
| `title` | string | Title of the page. |
| `fields` | object, string to string | Every field of the project by its key. The value is what the user sees in the popup (read value, possibly edited); an empty string if there is none. Values from clicked areas can be Markdown with line breaks by default (the format is selectable per field). |
| `content` | string | Main content of the page (header, navigation and footer are left out), in the format named by `content_format`, cut at 100,000 characters (`[… truncated]` marks a cut). Empty string if `content_format` is `none`. |
| `content_format` | string | `markdown` (default), `html` or `none`; set per project in the options page. `html` is cleaned: no `iframe`, `script`, `style`, form elements, event handler or `style` attributes, and all links and image addresses are absolute. |
| `note` | string | Free note typed by the user; may be empty. |
| `captured_at` | string | Time of sending, ISO 8601 in UTC. |
| `version` | number | Payload format version, currently `1`. Changes to the format increase it. |

Example:

```json
{
  "project": { "id": "articles", "name": "Articles" },
  "target": { "id": "inbox", "name": "Inbox" },
  "url": "https://example.com/article",
  "title": "Article",
  "fields": { "title": "Article", "price": "" },
  "content": "# Article\n\nBody text.",
  "content_format": "markdown",
  "note": "",
  "captured_at": "2026-01-02T03:04:05.000Z",
  "version": 1
}
```

## Response

- Success is any HTTP status 2xx. Anything else (including 3xx) is an error.
- At most 64 KB of the body is read.
- Optional: a JSON object body `{ "message": "...", "url": "..." }`.
  - `message` (string) is shown to the user as plain text.
  - `url` (string) is shown as a link only if it is an `http:` or `https:` address; other values are dropped.
  - Other keys are ignored.
- A body that is empty, not JSON, or not an object is fine for a 2xx response; the user then only sees that sending succeeded.
- On an error status the user sees the status and the first 300 characters of the body as plain text.
- Network errors, a missing host permission and timeouts are shown with fixed messages; no request is made without permission.

## Timeout and retries

A request is aborted after 15 seconds. There are no automatic retries; the user can send again. A second send to the same target for the same page is refused while one is running.
