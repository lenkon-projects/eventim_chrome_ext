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

    // Check if automation is active before extracting
    this.checkAutomationAndExtract();
  }

  async checkAutomationAndExtract() {
    // Check if automation is currently active
    const lockStatus = await this.getAutomationLock();

    if (!lockStatus.active) {
      this.logger.info('Automation not active, skipping report extraction');
      return;
    }

    this.logger.info('Automation is active, proceeding with extraction');
    // Automatically extract and send report
    this.extractAndSendReport();
  }

  async getAutomationLock() {
    return new Promise((resolve) => {
      // Check if CONFIG is loaded
      if (typeof CONFIG === 'undefined' || !CONFIG.AUTOMATION) {
        this.logger.warn('CONFIG not loaded yet, assuming automation inactive');
        resolve({ active: false, reason: 'config_not_loaded' });
        return;
      }

      try {
        chrome.storage.local.get([
          CONFIG.AUTOMATION.LOCK_KEY,
          CONFIG.AUTOMATION.SESSION_ID_KEY,
          CONFIG.AUTOMATION.START_TIME_KEY
        ], (data) => {
          if (chrome.runtime.lastError) {
            this.logger.error('Storage access error:', chrome.runtime.lastError);
            resolve({ active: false, reason: 'storage_error' });
            return;
          }

          const isActive = data[CONFIG.AUTOMATION.LOCK_KEY] || false;
          const startTime = data[CONFIG.AUTOMATION.START_TIME_KEY];

          // Check timeout
          if (isActive && startTime) {
            const elapsed = Date.now() - startTime;
            if (elapsed > CONFIG.AUTOMATION.TIMEOUT_MS) {
              this.logger.info('Automation lock expired');
              resolve({ active: false, reason: 'timeout' });
              return;
            }
          }

          resolve({
            active: isActive,
            sessionId: data[CONFIG.AUTOMATION.SESSION_ID_KEY],
            startTime: startTime
          });
        });
      } catch (error) {
        this.logger.error('Exception checking automation lock:', error);
        resolve({ active: false, reason: 'exception' });
      }
    });
  }

  async extractAndSendReport() {
    try {
      this.logger.info('Waiting for report to fully load');

      // Wait for report to fully load
      await this.waitForReportLoad();

      // Check for error page before extracting
      const errorCheck = this.checkForErrorPage();
      if (errorCheck.isError) {
        this.logger.error('Error page detected:', errorCheck.message);

        chrome.runtime.sendMessage({
          type: CONFIG.MESSAGE_TYPES.ERROR,
          error: {
            code: errorCheck.code,
            message: errorCheck.message
          },
          context: { page: 'report', url: window.location.href }
        });

        // Close error tab after short delay
        setTimeout(() => {
          this.logger.info('Closing error page tab');
          window.close();
        }, 1000);

        return;
      }

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

      this.logger.info('Report sent to background for processing');

      // Tab will be closed by background service worker after processing

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

  checkForErrorPage() {
    // Check for Eventim error messages
    const bodyText = document.body.textContent || '';
    const bodyHTML = document.body.innerHTML || '';

    // Check for login error (ErrorCode=10)
    if (bodyText.includes('User is no longer logged in') ||
        bodyText.includes('please log in again') ||
        bodyHTML.includes('ErrorCode=10')) {
      return {
        isError: true,
        code: CONFIG.ERROR_CODES.NOT_LOGGED_IN,
        message: 'Session expired. Please log in to Eventim again.'
      };
    }

    // Check for other common error patterns
    const errorPatterns = [
      { pattern: /error:/i, keyword: 'Error' },
      { pattern: /fehler:/i, keyword: 'Fehler' },
      { pattern: /access denied/i, keyword: 'Access Denied' },
      { pattern: /zugriff verweigert/i, keyword: 'Zugriff Verweigert' }
    ];

    for (const { pattern, keyword } of errorPatterns) {
      if (pattern.test(bodyText)) {
        // Check if this is in error styling
        const errorElements = document.querySelectorAll('.error, .errorMessage, [class*="error"]');
        if (errorElements.length > 0) {
          const errorText = Array.from(errorElements)
            .map(el => el.textContent.trim())
            .join('; ');

          if (errorText.length > 0) {
            return {
              isError: true,
              code: CONFIG.ERROR_CODES.UNKNOWN,
              message: `Report page error: ${errorText}`
            };
          }
        }
      }
    }

    // No errors detected
    return { isError: false };
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
