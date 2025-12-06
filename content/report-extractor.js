// Content script for extracting HTML reports from Eventim
// Runs only on report pages (public/Reports/*.html)

// Ensure CONFIG is available
if (typeof CONFIG === 'undefined') {
  console.error('CONFIG not loaded, using fallback');
  window.CONFIG = {
    MESSAGE_TYPES: {
      REPORT_READY: 'REPORT_READY',
      ERROR: 'ERROR'
    },
    ERROR_CODES: {
      UNKNOWN: 'UNKNOWN'
    }
  };
}

class ReportExtractor {
  constructor() {
    this.logger = createLogger('ReportExtractor');
    this.logger.info('Report extractor initialized');
    this.logger.info('CONFIG available:', typeof CONFIG !== 'undefined');

    // Automatically extract and send report
    this.extractAndSendReport();
  }

  async extractAndSendReport() {
    try {
      this.logger.info('Waiting for report to fully load');

      // Wait for report to fully load
      await this.waitForReportLoad();

      this.logger.info('Extracting report metadata');

      // Extract metadata
      const metadata = this.extractMetadata();

      this.logger.info('Metadata extracted:', metadata);

      // Get full HTML content
      const htmlContent = document.documentElement.outerHTML;

      this.logger.info(`HTML content extracted (${htmlContent.length} characters)`);

      // Send to background for download
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.REPORT_READY,
        reportData: {
          html: htmlContent,
          metadata: metadata,
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      });

      this.logger.info('Report sent to background for download');

      // Close tab after short delay
      setTimeout(() => {
        this.logger.info('Closing report tab');
        window.close();
      }, 1000);

    } catch (error) {
      this.logger.error('Failed to extract report:', error);

      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.ERROR,
        error: {
          code: CONFIG.ERROR_CODES.UNKNOWN,
          message: `Failed to extract report: ${error.message}`
        },
        context: { page: 'report', url: window.location.href }
      });
    }
  }

  async waitForReportLoad() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        // Extra delay to ensure all content loaded
        setTimeout(resolve, 500);
      } else {
        window.addEventListener('load', () => {
          setTimeout(resolve, 500);
        });
      }
    });
  }

  extractMetadata() {
    // Extract title
    const title = document.title || 'Report';

    // Get filename from URL
    const filename = window.location.pathname.split('/').pop();

    // Try to find date range in page content
    let dateRange = '';
    const dateRangeSelectors = [
      '.date-range',
      '.report-period',
      '.period',
      '[class*="date"]',
      '[id*="date"]'
    ];

    for (const selector of dateRangeSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        dateRange = element.textContent.trim();
        if (dateRange.length > 5) break;
      }
    }

    // Try to extract from text content if not found
    if (!dateRange) {
      // Look for date patterns in the document
      const bodyText = document.body.textContent;
      const datePatterns = [
        /From:\s*(\d{2}:\d{2}\s+\d{4}\s+[א-ת\s]+\d{2}\s+[א-ת\s]+).*?To:\s*(\d{2}:\d{2}\s+\d{4}\s+[א-ת\s]+\d{2}\s+[א-ת\s]+)/,
        /(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/,
        /(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/
      ];

      for (const pattern of datePatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          dateRange = match[0];
          break;
        }
      }
    }

    // Try to find event name
    let eventName = '';
    const eventNameSelectors = [
      'h1',
      'h2',
      '.event-title',
      '.report-title',
      '[class*="title"]',
      'table tbody tr:first-child td:first-child'
    ];

    for (const selector of eventNameSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent.trim();
        // Skip generic titles
        if (text && !text.toLowerCase().includes('sales trend') && text.length > 3) {
          eventName = text;
          break;
        }
      }
    }

    // Try to extract event name from table content
    if (!eventName) {
      // Look for event title in table rows
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const firstRow = table.querySelector('tbody tr');
        if (firstRow) {
          const cells = firstRow.querySelectorAll('td');
          if (cells.length > 0) {
            // Often the event name is in the first cell of data rows
            const text = cells[0].textContent.trim();
            if (text.length > 5 && !text.match(/^\d+$/)) {
              eventName = text;
              break;
            }
          }
        }
      }
    }

    return {
      title,
      filename,
      eventName: eventName || 'Unknown_Event',
      dateRange: dateRange || '',
      extractedAt: new Date().toISOString()
    };
  }
}

// Initialize extractor when script loads
new ReportExtractor();
