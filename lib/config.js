// Configuration constants for Eventim Report Downloader extension

const CONFIG = {
  // Flow states for state machine
  FLOW_STATES: {
    IDLE: 'idle',
    READY_TO_START: 'ready_to_start',
    NAVIGATING_TO_SALESTREND: 'navigating_to_salestrend',
    PROCESSING_EVENTS: 'processing_events',
    COMPLETE: 'complete',
    ERROR: 'error'
  },

  // Error codes
  ERROR_CODES: {
    NOT_LOGGED_IN: 'NOT_LOGGED_IN',
    ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
    POSTBACK_FAILED: 'POSTBACK_FAILED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
    TIMEOUT: 'TIMEOUT',
    API_ERROR: 'API_ERROR',
    API_TIMEOUT: 'API_TIMEOUT',
    API_AUTH_FAILED: 'API_AUTH_FAILED',
    UNKNOWN: 'UNKNOWN'
  },

  // Message types for communication between components
  MESSAGE_TYPES: {
    // From content scripts to background
    FLOW_STATE_CHANGE: 'FLOW_STATE_CHANGE',
    EVENT_DISCOVERED: 'EVENT_DISCOVERED',
    REPORT_READY: 'REPORT_READY',
    ERROR: 'ERROR',
    PROCESSING_EVENT: 'PROCESSING_EVENT',
    OPEN_REPORT_URL: 'OPEN_REPORT_URL',

    // From background to content scripts
    MANUAL_TRIGGER: 'MANUAL_TRIGGER',
    START_NAVIGATION: 'START_NAVIGATION',

    // Automation lock management
    CHECK_AUTOMATION_LOCK: 'CHECK_AUTOMATION_LOCK',
    CLEAR_AUTOMATION_LOCK: 'CLEAR_AUTOMATION_LOCK',

    // Status updates
    STATUS_UPDATE: 'STATUS_UPDATE'
  },

  // Default settings
  DEFAULTS: {
    SCHEDULE: {
      enabled: false,
      intervalValue: 60,  // Number of units
      intervalUnit: 'minutes'  // 'minutes' or 'hours'
    },
    FILENAME_PATTERN: '{eventName}_{dateRange}_{timestamp}.html',
    DELAYS: {
      min: 500,
      max: 2000
    },
    RETRY_ATTEMPTS: 3,
    NOTIFICATIONS: {
      completion: true,
      errors: true
    },
    SYNC_MODE: 'download'  // 'download' or 'api'
  },

  // Eventim URLs
  URLS: {
    START_PAGE: 'https://webreporting.eventim.de/webreporting/STOwnEvents.aspx',
    SALESTREND_BASE: 'https://webreporting.eventim.de/webreporting/SalesTrend.aspx',
    DETAILS_BASE: 'https://webreporting.eventim.de/webreporting/SalesTrendDetails.aspx',
    REPORTS_BASE: 'https://webreporting.eventim.de/webreporting/public/Reports/'
  },

  // Timing constants
  TIMING: {
    PAGE_LOAD_TIMEOUT: 30000,  // 30 seconds
    ELEMENT_WAIT_TIMEOUT: 10000,  // 10 seconds
    EVENT_PROCESSING_DELAY_MIN: 2000,  // 2 seconds
    EVENT_PROCESSING_DELAY_MAX: 5000,  // 5 seconds
    REPORT_EXTRACT_DELAY: 1000  // 1 second after report opens
  },

  // .NET ticks conversion constants
  DATE_CONVERSION: {
    TICKS_SINCE_1970: 621355968000000000n,
    TICKS_TO_MS: 10000n
  },

  // Automation lock management
  AUTOMATION: {
    TIMEOUT_MS: 30 * 60 * 1000,  // 30 minutes - global timeout
    STUCK_DETECTION_MS: 2 * 60 * 1000,  // 2 minutes - per-state stuck detection
    LOCK_KEY: 'automationActive',
    SESSION_ID_KEY: 'automationSessionId',
    TRIGGER_KEY: 'automationTrigger',
    START_TIME_KEY: 'automationStartTime',
    TAB_ID_KEY: 'automationTabId'
  },

  // API Integration
  API: {
    ENDPOINT: 'https://scrapper.liorizhakidrums.com/api/eventim/parse-and-sync',
    TIMEOUT_MS: 30000,  // 30 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_MS: 2000
  }
};

// Make CONFIG available globally
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}

// For service worker (background)
if (typeof globalThis !== 'undefined') {
  globalThis.CONFIG = CONFIG;
}
