# Release checklist

Manual check per release in **Brave** and **Edge**. Chrome is covered by the E2E suite. Use a throwaway browser profile and a test webhook you control (for example a local echo server or a disposable request-bin URL).

## Before

- [ ] The release workflow run for the tag is green and the GitHub release exists.
- [ ] Browser and version noted: Brave `____`, Edge `____`.

## Per browser

- [ ] Download the ZIP from the GitHub release and unpack it into an empty folder; `manifest.json` is at the folder root.
- [ ] Open the extensions page (`brave://extensions` or `edge://extensions`), enable developer mode, choose "Load unpacked" and select the folder.
- [ ] The extension loads without errors and the shown version equals the release version.
- [ ] Options page: import a configuration file; the projects appear.
- [ ] Options page: add a target (URL such as `https://example.com/hook`, optional header) and grant the host permission when the browser asks.
- [ ] Popup on a page that contains JSON-LD: the matching project is offered and the fields are prefilled.
- [ ] Popup on a page with only meta tags: the fields are prefilled from the meta tags.
- [ ] Map a field by click: start the picker from the popup, click an element; it is saved at once and the message names the website.
- [ ] Open a second page of the same site: the mapped field is prefilled.
- [ ] Side panel: in the options page choose "Side panel" under "Open as" (Brave: note whether the setting is visible); the browser shows its permission prompt for all websites; declining keeps the popup and shows a message; after granting, a click on the toolbar button opens the panel, and switching back to popup restores the popup.
- [ ] Side panel with the picker: start the picker from the panel; the panel stays open and shows the saved mapping without reopening.
- [ ] Side panel tab switch: with the access granted, switch to a never-visited website and navigate to another one; the panel reads each page without a click. On a browser page (for example `chrome://extensions`) the panel says the browser does not allow reading it and offers no button.
- [ ] Send to the test webhook: the success response is shown and the webhook received the expected payload.
- [ ] Error case: point the target at a URL that answers with an error status; the error is shown and nothing is reported as sent.
- [ ] Remove the extension; it disappears from the extensions page.

## Report

Record one line per browser in the release issue:

```
Brave <version>: pass | fail (<failed step, short note>)
Edge <version>: pass | fail (<failed step, short note>)
```

A single failed step makes that browser "fail". Do not paste tokens, webhook URLs or page content into the report.
