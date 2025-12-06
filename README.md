# Eventim Report Downloader

A Chrome extension to automate downloading sales reports from Eventim's Web Reporting system.

## Features

- **Automatic Downloads**: Schedule periodic downloads (daily, weekly, or custom intervals)
- **Manual Trigger**: Download reports on-demand with a single click
- **Session-Based**: Works with your existing browser login session (no credentials storage needed)
- **Smart Naming**: Automatically names files with event name, date range, and timestamp
- **Progress Tracking**: Visual feedback on current download status
- **Error Handling**: Graceful error recovery with retry logic
- **Human-Like Behavior**: Random delays to avoid detection

## Installation

### From Source (Developer Mode)

1. **Clone or download this repository** to your local machine

2. **Open Chrome** and navigate to `chrome://extensions/`

3. **Enable Developer Mode** (toggle in top-right corner)

4. **Click "Load unpacked"**

5. **Select the `eventim_chrome_ext` folder**

6. The extension should now appear in your extensions list

## Usage

### First-Time Setup

1. **Log in to Eventim Web Reporting** in your browser:
   - Navigate to https://webreporting.eventim.de/
   - Log in with your credentials
   - Make sure you can access the reports manually

2. **Click the extension icon** in your Chrome toolbar

3. **Open Settings** (click "Settings" link in the popup)

4. **Configure your preferences**:
   - Enable/disable automatic downloads
   - Set download frequency
   - Customize filename pattern
   - Adjust delays if needed

5. **Save settings**

### Manual Download

1. **Make sure you're logged in** to Eventim Web Reporting

2. **Click the extension icon** in Chrome toolbar

3. **Click "Download Reports Now"**

4. The extension will:
   - Navigate to the sales report page
   - Extract all events
   - Download HTML reports for each event
   - Save them to your Downloads folder under `Eventim_Reports/`

5. **Monitor progress** in the popup (shows current event being processed)

### Automatic Downloads

1. **Enable schedule** in Settings page

2. **Set frequency** (daily, weekly, or custom hours)

3. **Save settings**

4. The extension will automatically run at the scheduled interval

5. You'll receive a notification when downloads complete (if enabled)

## File Naming

Default filename pattern: `{eventName}_{dateRange}_{timestamp}.html`

**Available variables:**
- `{eventName}` - Event name from the report
- `{dateRange}` - Date range in format YYYYMMDD_YYYYMMDD
- `{timestamp}` - Current timestamp (ISO format)
- `{date}` - Current date (YYYY-MM-DD)
- `{reportId}` - Unique report ID from URL

**Example filenames:**
- `Led_Zeppelin_Concert_20250101_20251231_2025-12-06T10-30-00.html`
- `Festival_20250601_20250603_2025-12-06T14-15-30.html`

## Settings

### Schedule
- **Enable automatic downloads**: Turn scheduled downloads on/off
- **Frequency**: Daily, weekly, or custom hours
- **Custom hours**: Set specific interval (1-168 hours)

### File Naming
- **Filename pattern**: Customize how files are named using variables

### Advanced
- **Delay between actions**: Min/max milliseconds for random delays
- **Retry attempts**: Number of times to retry failed operations (0-10)

### Notifications
- **Completion notifications**: Show when all reports downloaded
- **Error notifications**: Show when errors occur

## Troubleshooting

### Extension doesn't start

- **Make sure you're logged in** to Eventim Web Reporting
- Check that you can access reports manually first
- Try reloading the extension (chrome://extensions/)

### No events found

- Verify you have events in the date range
- Try navigating to the Salestrend page manually
- Check browser console for errors (F12 → Console)

### Reports not downloading

- Check Chrome's download settings
- Ensure Downloads folder is accessible
- Look for download permission prompts
- Check console for error messages

### Detection/Blocking

- Increase delay ranges in Advanced settings
- Disable schedule and only use manual trigger
- Add longer delays between events
- Try running during off-peak hours

### Session expired

- Re-login to Eventim Web Reporting
- Trigger manual download again
- Extension will detect login status and show error if needed

## Technical Details

### Architecture

- **Manifest V3** Chrome extension
- **Background Service Worker** for orchestration and scheduling
- **Content Scripts**:
  - Navigator: Handles multi-page navigation and event extraction
  - Extractor: Extracts HTML from report pages
- **Popup UI**: Status display and manual trigger
- **Options Page**: Settings configuration

### Permissions

- `storage` - Save settings and state
- `alarms` - Schedule periodic downloads
- `downloads` - Save reports to disk
- `scripting` - Inject content scripts
- `tabs` - Manage Eventim tabs
- `notifications` - Show completion/error alerts
- `host_permissions` - Access webreporting.eventim.de

### How It Works

1. **Navigation**: Executes ASP.NET WebForms postback to reach SalesTrend page
2. **Event Discovery**: Parses page to find all event detail links
3. **Sequential Processing**: Navigates to each event's detail page
4. **Report Extraction**: Clicks HTML export button, extracts content in new tab
5. **Download**: Creates blob from HTML and triggers Chrome download
6. **Cleanup**: Closes report tab, continues with next event

### Date Decoding

Eventim uses .NET ticks for dates in URLs:
- .NET ticks = 100-nanosecond intervals since 0001-01-01
- Converted to JavaScript Date using BigInt arithmetic
- Example: `639005760000000000` → `2025-01-01`

## Development

### File Structure

```
eventim_chrome_ext/
├── manifest.json              # Extension configuration
├── background/
│   └── service-worker.js      # Background orchestration
├── content/
│   ├── eventim-navigator.js   # Navigation & event extraction
│   └── report-extractor.js    # Report HTML extraction
├── lib/
│   ├── config.js              # Constants and configuration
│   ├── logger.js              # Logging utility
│   └── storage.js             # Storage API wrapper
├── ui/
│   ├── popup/                 # Extension popup
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── options/               # Settings page
│       ├── options.html
│       ├── options.css
│       └── options.js
└── icons/                     # Extension icons
    ├── icon.svg
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Debugging

1. **Background Worker Console**:
   - Go to `chrome://extensions/`
   - Find extension and click "service worker"
   - Opens DevTools for background script

2. **Content Script Console**:
   - Open Eventim page
   - Press F12 to open DevTools
   - Check Console tab for `[EventimExt]` logs

3. **Popup Console**:
   - Right-click extension icon
   - Select "Inspect popup"
   - Check Console tab

### Customization

You can modify the extension behavior by editing:

- `lib/config.js` - Adjust timeouts, URLs, constants
- `background/service-worker.js` - Change orchestration logic
- `content/eventim-navigator.js` - Modify navigation flow
- UI files - Customize appearance

## Known Limitations

- Requires active browser session (can't run when browser is closed)
- Sequential processing (one event at a time to avoid detection)
- Depends on Eventim's page structure (may break if they redesign)
- Chrome alarms minimum interval is 1 minute
- Downloads to Chrome's default Downloads folder

## Privacy & Security

- **No data collection**: Extension doesn't send data anywhere
- **Local storage only**: Settings stored locally in Chrome
- **No credential storage**: Uses your existing browser session
- **No external servers**: All processing happens locally
- **Open source**: Full code available for review

## Support

If you encounter issues:

1. Check the Troubleshooting section above
2. Look at browser console for error messages
3. Try disabling/re-enabling the extension
4. Check that you're using the latest version

## License

This extension is provided as-is for personal use.

## Changelog

### Version 1.0.0 (2025-12-06)
- Initial release
- Automatic and manual downloads
- Configurable scheduling
- Smart file naming
- Error handling and retry logic
- Progress tracking
- Notification support
