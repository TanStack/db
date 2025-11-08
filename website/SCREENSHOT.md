# Generating Screenshots

## Quick Method (Browser DevTools)

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open http://localhost:5173 in Chrome or Edge

3. Take a full-page screenshot:
   - Press `Cmd/Ctrl + Shift + P` to open the command palette
   - Type "Capture full size screenshot"
   - Press Enter
   - The screenshot will be saved to your Downloads folder

## Using Playwright (Recommended for CI/CD)

```bash
# Install Playwright
npm install -D @playwright/test

# Take a screenshot
npx playwright screenshot http://localhost:5173 screenshot.png --full-page
```

## Using Browser Extensions

Install a screenshot extension like:
- [Full Page Screen Capture](https://chrome.google.com/webstore/detail/full-page-screen-capture/fdpohaocaechififmbbbbbknoalclacl)
- [GoFullPage](https://chrome.google.com/webstore/detail/gofullpage-full-page-scre/fdpohaocaechififmbbbbbknoalclacl)

## Automated Screenshot Generation

For automated screenshot generation in CI/CD pipelines, consider:
- GitHub Actions with Playwright
- Percy.io for visual regression testing
- Chromatic for Storybook integration
