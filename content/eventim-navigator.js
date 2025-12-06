// Content script for navigating Eventim Web Reporting pages
// Handles multi-page flow, WebForms postback, and event extraction

class EventimNavigator {
  constructor() {
    this.logger = createLogger('Navigator');
    this.currentState = null;
    this.eventQueue = [];
    this.currentEventIndex = 0;
    this.retryCount = 0;

    // Listen for commands from background
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // Auto-detect page type and notify
    this.detectPageAndNotify();
  }

  handleMessage(message, sender, sendResponse) {
    this.logger.info('Received message:', message.type);

    switch (message.type) {
      case CONFIG.MESSAGE_TYPES.START_NAVIGATION:
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
      state: 'READY_TO_START'
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

    // Extract all events
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

    // Find HTML export button
    const htmlButton = this.findHtmlButton();

    if (!htmlButton) {
      this.logger.error('HTML button not found');
      chrome.runtime.sendMessage({
        type: CONFIG.MESSAGE_TYPES.ERROR,
        error: {
          code: CONFIG.ERROR_CODES.ELEMENT_NOT_FOUND,
          message: 'Could not find HTML export button'
        },
        context: { page: 'details' }
      });

      // Try to go back and continue with next event
      await this.goBackAndContinue();
      return;
    }

    this.logger.info('HTML button found, clicking');

    // Add delay before clicking
    await this.randomDelay(500, 1000);

    // Click to open report in new tab
    // The new tab will have report-extractor.js injected
    htmlButton.click();

    this.logger.info('Waiting for report to be downloaded');

    // Wait for report to be downloaded, then go back
    setTimeout(async () => {
      await this.goBackAndContinue();
    }, 5000); // 5 seconds should be enough for report extraction
  }

  async goBackAndContinue() {
    this.logger.info('Going back to SalesTrend page');

    // Go back to SalesTrend page
    window.history.back();

    // Wait for page to load
    await this.randomDelay(1000, 2000);

    // Move to next event
    this.currentEventIndex++;

    // Process next event
    // We'll detect we're back on SalesTrend page and need to continue
    // For now, set a flag in session storage
    sessionStorage.setItem('eventim_current_index', this.currentEventIndex);
    sessionStorage.setItem('eventim_event_queue', JSON.stringify(this.eventQueue));

    // After page loads (history.back), we need to continue processing
    // We'll check session storage in onSalesTrendPage
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

// Check if we're resuming from session storage
window.addEventListener('load', async () => {
  const savedIndex = sessionStorage.getItem('eventim_current_index');
  const savedQueue = sessionStorage.getItem('eventim_event_queue');

  if (savedIndex && savedQueue && window.location.href.includes('SalesTrend.aspx')) {
    navigator.logger.info('Resuming from saved state');
    navigator.currentEventIndex = parseInt(savedIndex, 10);
    navigator.eventQueue = JSON.parse(savedQueue);

    // Clear session storage
    sessionStorage.removeItem('eventim_current_index');
    sessionStorage.removeItem('eventim_event_queue');

    // Continue processing
    await navigator.randomDelay(1000, 2000);
    await navigator.processNextEvent();
  }
});
