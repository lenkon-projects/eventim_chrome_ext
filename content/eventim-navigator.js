// Content script for navigating Eventim Web Reporting pages
// Handles multi-page flow, WebForms postback, and event extraction

class EventimNavigator {
  constructor() {
    this.logger = createLogger('Navigator');
    this.currentState = null;
    this.eventQueue = [];
    this.currentEventIndex = 0;
    this.retryCount = 0;
    this.sessionId = null;  // Track automation session ID

    // Setup message listener
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    this.logger.info('EventimNavigator initialized');

    // Check if automation is active and resume if needed
    this.checkAndResume();
  }

  async checkAndResume() {
    // Check if automation is currently active
    const lockStatus = await this.getAutomationLock();

    if (!lockStatus.active) {
      this.logger.info('No active automation, waiting for START_NAVIGATION message');
      return;
    }

    // Automation is active - check current page and resume
    this.logger.info('Automation is active, checking current page');
    this.sessionId = lockStatus.sessionId;

    // Skip auto-resume on start page - that should only be triggered by START_NAVIGATION
    const url = window.location.href;
    if (url.includes('STOwnEvents.aspx')) {
      this.logger.info('On start page, waiting for START_NAVIGATION message');
      return;
    }

    // On other pages during active automation, detect and proceed
    await this.detectPageAndNotify();
  }

  async getAutomationLock() {
    // Use chrome.storage to check lock (only local storage for content scripts)
    return new Promise((resolve) => {
      // Check if CONFIG is loaded
      if (typeof CONFIG === 'undefined' || !CONFIG.AUTOMATION) {
        this.logger.warn('CONFIG not loaded yet, assuming automation inactive');
        resolve({ active: false, reason: 'config_not_loaded' });
        return;
      }

      try {
        // Content scripts can only reliably use chrome.storage.local
        chrome.storage.local.get([
          CONFIG.AUTOMATION.LOCK_KEY,
          CONFIG.AUTOMATION.SESSION_ID_KEY,
          CONFIG.AUTOMATION.START_TIME_KEY
        ], (data) => {
          // Check for chrome runtime errors
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

  handleMessage(message, sender, sendResponse) {
    this.logger.info('Received message:', message.type);

    switch (message.type) {
      case CONFIG.MESSAGE_TYPES.START_NAVIGATION:
        // Store session ID from background
        this.sessionId = message.sessionId;

        // Handle async navigation
        this.startNavigation()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }

    // For other messages, don't return true
    return false;
  }

  async detectPageAndNotify() {
    const url = window.location.href;
    this.logger.info('Page detected:', url);

    if (url.includes('STOwnEvents.aspx')) {
      await this.onStartPage();
    } else if (url.includes('SalesTrend.aspx') && !url.includes('Details')) {
      await this.onSalesTrendPage();
    } else if (url.includes('SalesTrendDetails.aspx')) {
      await this.onDetailsPage();
    }
  }

  async onStartPage() {
    this.logger.info('On start page (STOwnEvents)');

    // Check if logged in
    if (!this.isLoggedIn()) {
      this.logger.error('User not logged in');
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.ERROR,
        error: {
          code: CONFIG.ERROR_CODES.NOT_LOGGED_IN,
          message: 'Please log in to Eventim Web Reporting first'
        }
      });
      return;
    }

    // Notify ready
    chrome.runtime.sendMessage({
      type: CONFIG.MESSAGE_TYPES.FLOW_STATE_CHANGE,
      state: CONFIG.FLOW_STATES.READY_TO_START
    });
  }

  async startNavigation() {
    this.logger.info('Starting navigation to SalesTrend');

    try {
      await this.navigateToSalesTrend();
    } catch (error) {
      this.logger.error('Navigation failed:', error);
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.ERROR,
        error: {
          code: CONFIG.ERROR_CODES.POSTBACK_FAILED,
          message: error.message
        }
      });
    }
  }

  async navigateToSalesTrend() {
    this.logger.info('Navigating to SalesTrend page');

    // Wait for WebForms functions to load
    this.logger.info('Waiting for WebForms functions to load');
    const webformLoaded = await this.waitForWebForms(5000);

    // Add human-like delay
    await this.randomDelay(500, 1500);

    // Call showLoading() if it exists (shows the loading spinner)
    if (typeof showLoading === 'function') {
      this.logger.info('Calling showLoading()');
      showLoading();
    }

    await this.randomDelay(100, 300);

    // Try multiple approaches to trigger the postback

    // Approach 1: Try WebForm_DoPostBackWithOptions
    if (typeof WebForm_DoPostBackWithOptions === 'function') {
      this.logger.info('Using WebForm_DoPostBackWithOptions');
      WebForm_DoPostBackWithOptions(
        new WebForm_PostBackOptions(
          "master$content$lnkPromoter",
          "",
          true,
          "",
          "",
          false,
          true
        )
      );
      this.logger.info('Postback executed');
      return;
    }

    // Approach 2: Try __doPostBack
    if (typeof __doPostBack === 'function') {
      this.logger.info('Using __doPostBack');
      __doPostBack('master$content$lnkPromoter', '');
      this.logger.info('Postback executed');
      return;
    }

    // Approach 3: Manual form submission
    this.logger.info('Trying manual form submission');
    const form = document.forms[0] || document.querySelector('form');
    if (form) {
      // Set the event target and argument
      let eventTarget = form.querySelector('input[name="__EVENTTARGET"]');
      let eventArgument = form.querySelector('input[name="__EVENTARGUMENT"]');

      if (!eventTarget) {
        eventTarget = document.createElement('input');
        eventTarget.type = 'hidden';
        eventTarget.name = '__EVENTTARGET';
        form.appendChild(eventTarget);
      }

      if (!eventArgument) {
        eventArgument = document.createElement('input');
        eventArgument.type = 'hidden';
        eventArgument.name = '__EVENTARGUMENT';
        form.appendChild(eventArgument);
      }

      eventTarget.value = 'master$content$lnkPromoter';
      eventArgument.value = '';

      this.logger.info('Submitting form manually');
      form.submit();
      return;
    }

    throw new Error('No postback method available');
  }

  findSalesTrendLink() {
    // Try to find link by various methods
    const selectors = [
      '#master_content_lnkPromoter',        // Exact ID from HTML
      'a[id="master_content_lnkPromoter"]', // Alternative
      'a[id*="lnkPromoter"]',               // Partial match
      'a[href*="SalesTrend"]',              // Links to SalesTrend
      'a[href*="WebForm_DoPostBackWithOptions"]', // Links with postback
      'div.resultBox a'                     // Link inside resultBox
    ];

    for (const selector of selectors) {
      try {
        const link = document.querySelector(selector);
        if (link) {
          this.logger.info('Found link with selector:', selector, 'Text:', link.textContent);
          return link;
        }
      } catch (e) {
        this.logger.warn('Selector failed:', selector, e);
      }
    }

    // Try to find by text content (looking for promoter/event numbers)
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
      const text = link.textContent.toLowerCase();
      const href = (link.href || '').toLowerCase();

      // Look for links that might be the promoter link
      if (href.includes('webform_dopostbackwithoptions') ||
          href.includes('salestrend') ||
          text.includes('salestrend') ||
          text.includes('verkaufstrend')) {
        this.logger.info('Found link by text/href:', link.textContent);
        return link;
      }
    }

    return null;
  }

  async waitForWebForms(timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check for either WebForm function or __doPostBack
      if (typeof WebForm_DoPostBackWithOptions === 'function' ||
          typeof __doPostBack === 'function') {
        return true;
      }
      await this.randomDelay(100, 200);
    }

    return false;
  }

  async onSalesTrendPage() {
    this.logger.info('On SalesTrend page');

    // Wait for page to fully load
    await this.waitForPageLoad();

    // Check if we're resuming from chrome.storage (back from details page)
    const progress = await chrome.storage.local.get(['eventProgressIndex', 'eventProgressQueue']);

    if (progress.eventProgressIndex !== undefined && progress.eventProgressQueue) {
      this.logger.info('Resuming from saved progress');
      this.currentEventIndex = progress.eventProgressIndex;
      this.eventQueue = progress.eventProgressQueue;

      // Clear saved progress
      await chrome.storage.local.remove(['eventProgressIndex', 'eventProgressQueue']);

      // FIX: Send state update when resuming
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.FLOW_STATE_CHANGE,
        state: CONFIG.FLOW_STATES.PROCESSING_EVENTS,
        data: {
          currentEvent: {
            index: this.currentEventIndex,
            total: this.eventQueue.length
          }
        }
      });

      // Continue processing from where we left off
      await this.randomDelay(1000, 2000);
      await this.processNextEvent();
      return;
    }

    // First time on page - extract all events
    const events = this.extractEvents();

    if (events.length === 0) {
      this.logger.warn('No events found');
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.FLOW_STATE_CHANGE,
        state: CONFIG.FLOW_STATES.COMPLETE,
        data: { message: 'No events found' }
      });
      return;
    }

    this.logger.info(`Found ${events.length} events`);
    this.eventQueue = events;

    // Notify background
    chrome.runtime.sendMessage({
      type: CONFIG.MESSAGE_TYPES.EVENT_DISCOVERED,
      events: events
    });

    // Start processing first event
    await this.randomDelay(1000, 2000);
    await this.processNextEvent();
  }

  extractEventInfoFromUrl(url) {
    // Extract event info from SalesTrendDetails URL
    // URL format: SalesTrendDetails.aspx?RestrictionType=Client&RestrictionID=0&BeginDate=...&EndDate=...
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;

      const beginDate = params.get('BeginDate');
      const endDate = params.get('EndDate');

      // Try to get event name from page title or content
      let eventName = 'Single Event';
      const pageTitle = document.title;
      if (pageTitle && !pageTitle.includes('Sales Trend')) {
        eventName = pageTitle;
      }

      return {
        name: eventName,
        url: url,
        index: 0,
        beginDate: beginDate,
        endDate: endDate
      };
    } catch (error) {
      this.logger.error('Failed to extract event info from URL:', error);
      return {
        name: 'Unknown Event',
        url: url,
        index: 0
      };
    }
  }

  extractEvents() {
    this.logger.info('Extracting events from page');
    const events = [];

    // Strategy 1: Look for links to SalesTrendDetails.aspx
    const links = document.querySelectorAll('a[href*="SalesTrendDetails.aspx"]');
    this.logger.info(`Found ${links.length} detail links`);

    links.forEach((link, index) => {
      const href = link.href;

      // Extract event name from link text or nearby elements
      let eventName = link.textContent?.trim();

      // Try to find event name in parent row
      if (!eventName || eventName.length < 3) {
        const row = link.closest('tr');
        if (row) {
          const cells = row.querySelectorAll('td');
          eventName = Array.from(cells).map(c => c.textContent.trim()).join(' ');
        }
      }

      if (!eventName || eventName.length < 3) {
        eventName = `Event_${index + 1}`;
      }

      events.push({
        name: eventName,
        url: href,
        index: index
      });
    });

    // Strategy 2: If no links found, look for clickable rows or other patterns
    if (events.length === 0) {
      this.logger.info('No links found, trying alternative extraction');

      // Look for rows with onclick handlers
      const clickableRows = document.querySelectorAll('tr[onclick], table tbody tr');

      clickableRows.forEach((row, index) => {
        const onclick = row.getAttribute('onclick') || '';

        // Check if row navigates to details
        if (onclick.includes('SalesTrendDetails') || onclick.includes('location')) {
          const urlMatch = onclick.match(/location\.href='([^']+)'/);
          if (urlMatch) {
            const eventName = row.textContent?.trim() || `Event_${index + 1}`;
            events.push({
              name: eventName,
              url: urlMatch[1],
              index: index,
              element: row
            });
          }
        }
      });
    }

    this.logger.info(`Extracted ${events.length} events`);
    return events;
  }

  async processNextEvent() {
    if (this.currentEventIndex >= this.eventQueue.length) {
      this.logger.info('All events processed');
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.FLOW_STATE_CHANGE,
        state: CONFIG.FLOW_STATES.COMPLETE
      });
      return;
    }

    const event = this.eventQueue[this.currentEventIndex];

    this.logger.info(`Processing event ${this.currentEventIndex + 1}/${this.eventQueue.length}: ${event.name}`);

    chrome.runtime.sendMessage({
      type: CONFIG.MESSAGE_TYPES.PROCESSING_EVENT,
      data: {
        event,
        index: this.currentEventIndex,
        total: this.eventQueue.length
      }
    });

    // Add delay before navigation
    await this.randomDelay(2000, 4000);

    // Navigate to event details
    window.location.href = event.url;
  }

  async onDetailsPage() {
    this.logger.info('On event details page');

    // Wait for page to load
    await this.waitForPageLoad();

    // Restore event queue from storage if empty (page was reloaded)
    if (this.eventQueue.length === 0) {
      this.logger.info('Event queue is empty, restoring from storage');
      const progress = await chrome.storage.local.get(['eventProgressIndex', 'eventProgressQueue']);

      if (progress.eventProgressQueue) {
        this.eventQueue = progress.eventProgressQueue;
        this.currentEventIndex = progress.eventProgressIndex || 0;
        this.logger.info(`Restored queue: ${this.eventQueue.length} events, current index: ${this.currentEventIndex}`);
      } else {
        this.logger.info('No event queue found in storage - single event case');

        // SINGLE EVENT CASE: Navigation went directly from start page to details
        // Create a virtual queue with current event from URL
        const currentUrl = window.location.href;
        const eventInfo = this.extractEventInfoFromUrl(currentUrl);

        this.eventQueue = [eventInfo];
        this.currentEventIndex = 0;

        this.logger.info(`Created virtual queue for single event: ${eventInfo.name}`);

        // Notify background about the single event
        chrome.runtime.sendMessage({
          type: CONFIG.MESSAGE_TYPES.EVENT_DISCOVERED,
          events: this.eventQueue
        });
      }
    }

    // FIX: Send state update to indicate we're processing this event
    chrome.runtime.sendMessage({
      type: CONFIG.MESSAGE_TYPES.FLOW_STATE_CHANGE,
      state: CONFIG.FLOW_STATES.PROCESSING_EVENTS,
      data: {
        status: 'Downloading report',
        currentEvent: {
          index: this.currentEventIndex,
          total: this.eventQueue.length
        }
      }
    });

    // Find HTML export button
    const htmlButton = this.findHtmlButton();

    if (!htmlButton) {
      this.logger.error('HTML button not found');

      // Increment retry count
      this.retryCount++;

      // Check retry limit
      if (this.retryCount >= 3) {
        this.logger.error('Max retries (3) reached for HTML button, skipping event');

        const currentEvent = this.eventQueue[this.currentEventIndex];
        chrome.runtime.sendMessage({
          type: CONFIG.MESSAGE_TYPES.ERROR,
          error: {
            code: CONFIG.ERROR_CODES.ELEMENT_NOT_FOUND,
            message: `Could not find HTML export button after 3 retries for event: ${currentEvent?.name || 'Unknown'}`
          },
          context: {
            page: 'details',
            event: currentEvent,
            retries: this.retryCount
          }
        });

        // Reset retry count and skip to next event
        this.retryCount = 0;
        await this.goBackAndContinue();
        return;
      }

      // Retry: go back and try this event again
      this.logger.info(`Retry ${this.retryCount}/3 for current event`);
      this.currentEventIndex--; // Decrement to retry same event
      await this.goBackAndContinue();
      return;
    }

    this.logger.info('HTML button found, extracting URL');
    this.retryCount = 0; // Reset retry count on success

    // Extract URL from button href
    const reportUrl = htmlButton.href;
    if (!reportUrl) {
      this.logger.error('HTML button has no href attribute');
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.ERROR,
        error: {
          code: CONFIG.ERROR_CODES.ELEMENT_NOT_FOUND,
          message: 'HTML button has no URL'
        }
      });
      return;
    }

    this.logger.info('Opening report URL in background tab:', reportUrl);

    // Add delay before opening
    await this.randomDelay(500, 1000);

    // Send message to background to open URL in background tab (without stealing focus)
    // The new tab will have report-extractor.js injected
    chrome.runtime.sendMessage({
      type: CONFIG.MESSAGE_TYPES.OPEN_REPORT_URL,
      url: reportUrl
    });

    this.logger.info('Waiting for report to be downloaded');

    // Wait for report to be downloaded, then go back
    setTimeout(async () => {
      await this.goBackAndContinue();
    }, 5000); // 5 seconds should be enough for report extraction
  }

  async goBackAndContinue() {
    this.logger.info('Going back to continue processing');

    // Move to next event
    this.currentEventIndex++;

    // Check if all events are processed
    if (this.currentEventIndex >= this.eventQueue.length) {
      this.logger.info('All events processed, completing automation');

      // Clear saved progress
      await chrome.storage.local.remove(['eventProgressIndex', 'eventProgressQueue']);

      // Send COMPLETE state
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.FLOW_STATE_CHANGE,
        state: CONFIG.FLOW_STATES.COMPLETE
      });

      // Navigate back to start page
      this.logger.info('Navigating to start page');
      await this.randomDelay(1000, 2000);
      window.location.href = CONFIG.URLS.START_PAGE;

      return;
    }

    // More events to process - save progress and go back
    this.logger.info(`${this.eventQueue.length - this.currentEventIndex} events remaining`);

    // Save progress to chrome.storage
    await chrome.storage.local.set({
      eventProgressIndex: this.currentEventIndex,
      eventProgressQueue: this.eventQueue
    });

    // Go back to SalesTrend page
    window.history.back();

    // Wait for page to load
    await this.randomDelay(1000, 2000);

    // After page loads (history.back), we need to continue processing
    // We'll check chrome.storage in onSalesTrendPage
  }

  findHtmlButton() {
    // Look for button/link with text "HTML" or specific ID
    const candidates = [
      ...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')
    ];

    const htmlButton = candidates.find(el => {
      const text = (el.textContent || el.value || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      const name = (el.name || '').toLowerCase();

      return text.includes('html') ||
             text === 'html' ||
             id.includes('html') ||
             name.includes('html');
    });

    if (htmlButton) {
      this.logger.info('Found HTML button:', htmlButton.tagName, htmlButton.textContent || htmlButton.value);
    }

    return htmlButton;
  }

  isLoggedIn() {
    // Check for login indicators
    // Usually: presence of logout button, username display, or absence of login form

    // Check for login form elements (indicates NOT logged in)
    const loginIndicators = document.querySelectorAll('[name="txtLogin"], [name="txtPassword"], .login-form, input[type="password"]');
    if (loginIndicators.length > 0) {
      return false;
    }

    // Check for logged-in indicators
    const loggedInIndicators = document.querySelectorAll('.user-name, .logout-button, [href*="logout"], [href*="Logout"]');
    if (loggedInIndicators.length > 0) {
      return true;
    }

    // If we're on the internal webreporting pages (not login page), assume logged in
    if (window.location.href.includes('/webreporting/') && !window.location.href.includes('login')) {
      return true;
    }

    return false;
  }

  async waitForPageLoad() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        setTimeout(resolve, 500);
      } else {
        window.addEventListener('load', () => {
          setTimeout(resolve, 500);
        });
      }
    });
  }

  async randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    this.logger.debug(`Delaying ${delay}ms`);
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}

// Initialize navigator when script loads
const navigator = new EventimNavigator();

// Resume from saved progress after page navigation (history.back)
window.addEventListener('load', async () => {
  // Check if we were in the middle of processing events
  const progress = await chrome.storage.local.get(['eventProgressIndex', 'eventProgressQueue']);

  // ONLY resume if we have saved progress AND we're on the SalesTrend page
  if (progress.eventProgressIndex !== undefined &&
      progress.eventProgressQueue &&
      window.location.href.includes('SalesTrend.aspx')) {

    navigator.logger.info('Resuming from saved progress (returned from event details)');
    navigator.currentEventIndex = progress.eventProgressIndex;
    navigator.eventQueue = progress.eventProgressQueue;

    // Clear saved progress
    await chrome.storage.local.remove(['eventProgressIndex', 'eventProgressQueue']);

    // Continue processing next event
    await navigator.randomDelay(1000, 2000);
    await navigator.processNextEvent();
  }
  // Otherwise, do nothing - automation only starts via START_NAVIGATION message
});
