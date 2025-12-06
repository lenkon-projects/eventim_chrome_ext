// Background service worker for Eventim Report Downloader extension
// Handles orchestration, scheduling, state management, and downloads

// Import config and utilities
importScripts('../lib/config.js', '../lib/logger.js', '../lib/storage.js');

const logger = createLogger('Background');

// Installation
chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info('Extension installed:', details.reason);

  if (details.reason === 'install') {
    // Initialize default settings
    await storage.saveSettings(CONFIG.DEFAULTS);
    logger.info('Default settings initialized');
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.info('Received message:', message.type, message);

  // Handle messages asynchronously
  (async () => {
    try {
      switch (message.type) {
        case CONFIG.MESSAGE_TYPES.MANUAL_TRIGGER:
          await handleManualTrigger();
          break;

        case CONFIG.MESSAGE_TYPES.FLOW_STATE_CHANGE:
          await handleStateChange(message.state, message.data);
          break;

        case CONFIG.MESSAGE_TYPES.EVENT_DISCOVERED:
          await handleEventDiscovered(message.events);
          break;

        case CONFIG.MESSAGE_TYPES.PROCESSING_EVENT:
          await handleProcessingEvent(message.data);
          break;

        case CONFIG.MESSAGE_TYPES.REPORT_READY:
          await handleReportReady(message.reportData);
          break;

        case CONFIG.MESSAGE_TYPES.ERROR:
          await handleError(message.error, message.context);
          break;
      }
      sendResponse({ success: true });
    } catch (error) {
      logger.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep message channel open for async responses
});

// Alarm handler for scheduled downloads
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'eventim-download') {
    logger.info('Scheduled download alarm triggered');

    // Check if enough time has passed since last run
    const shouldRun = await shouldRunScheduledDownload();
    if (shouldRun) {
      await initiateDownloadFlow('scheduled');
    } else {
      logger.info('Skipping scheduled run - ran too recently');
    }
  }
});

// Monitor tab closure to clear automation lock
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const lockStatus = await storage.checkAutomationLock();
  if (lockStatus.active && lockStatus.tabId === tabId) {
    logger.warn('Automation tab closed, clearing lock');
    await storage.clearAutomationLock();
    await storage.setState(CONFIG.FLOW_STATES.ERROR, {
      message: 'Automation interrupted: tab closed'
    });
    notifyStatusUpdate();
  }
});

// Check if scheduled download should run
async function shouldRunScheduledDownload() {
  const state = await storage.getState();

  if (!state.lastRun?.timestamp) {
    return true;
  }

  const hoursSinceLastRun = (Date.now() - new Date(state.lastRun.timestamp).getTime()) / (1000 * 60 * 60);
  const minInterval = 23; // At least 23 hours between runs

  return hoursSinceLastRun >= minInterval;
}

// Manual trigger from popup
async function handleManualTrigger() {
  logger.info('Manual trigger initiated');
  await initiateDownloadFlow('manual');
}

// Main download flow orchestration
async function initiateDownloadFlow(trigger = 'manual') {
  logger.info(`Initiating download flow (${trigger})`);

  try {
    // Check if automation already running
    const lockStatus = await storage.checkAutomationLock();
    if (lockStatus.active) {
      logger.warn('Automation already in progress');
      return;
    }

    // Reset state
    await storage.clearState();
    await storage.setState(CONFIG.FLOW_STATES.IDLE);

    // Get or create Eventim tab
    const tab = await getOrCreateEventimTab();

    // SET AUTOMATION LOCK - This enables automation
    const sessionId = await storage.setAutomationLock(trigger, tab.id);
    logger.info('Automation lock set with session ID:', sessionId);

    // Send message to content script to start navigation
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: CONFIG.MESSAGE_TYPES.START_NAVIGATION,
        sessionId: sessionId  // Include session ID
      });
    } catch (error) {
      logger.error('Failed to send START_NAVIGATION message:', error);
      await storage.cleanupAutomation();
      await storage.recordError({
        code: CONFIG.ERROR_CODES.UNKNOWN,
        message: `Failed to communicate with tab: ${error.message}`
      });
      throw error;
    }

    // Update state
    await storage.setState(CONFIG.FLOW_STATES.NAVIGATING_TO_SALESTREND);

    // Notify popup
    notifyStatusUpdate();

  } catch (error) {
    logger.error('Failed to initiate download flow:', error);
    // Clear lock on error
    await storage.clearAutomationLock();
    await storage.recordError({
      code: CONFIG.ERROR_CODES.UNKNOWN,
      message: error.message
    });
  }
}

// Get or create Eventim tab
async function getOrCreateEventimTab() {
  // Find existing Eventim tab
  const tabs = await chrome.tabs.query({
    url: 'https://webreporting.eventim.de/*'
  });

  if (tabs.length > 0) {
    logger.info('Found existing Eventim tab:', tabs[0].id);

    // Reload the tab to ensure content script is loaded
    // This fixes "Could not establish connection" error
    logger.info('Reloading tab to ensure content script is loaded');
    await chrome.tabs.reload(tabs[0].id);

    // Wait for tab to finish loading
    let loadCompleted = false;
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tabs[0].id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          loadCompleted = true;
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Timeout after 10 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });

    // FIX: Check if load completed
    if (!loadCompleted) {
      logger.error('Tab reload timed out after 10 seconds');
      await storage.cleanupAutomation();
      await storage.setState(CONFIG.FLOW_STATES.ERROR, {
        message: 'Tab reload timeout'
      });
      throw new Error('Tab reload timeout');
    }

    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0];
  }

  // Create new tab
  logger.info('Creating new Eventim tab');
  const newTab = await chrome.tabs.create({
    url: CONFIG.URLS.START_PAGE,
    active: false // Background tab
  });

  // Wait for new tab to load
  await new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Timeout after 10 seconds
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });

  return newTab;
}

// Handle state changes from content scripts
async function handleStateChange(state, data) {
  logger.info('State change:', state, data);
  await storage.setState(state, data);

  // Clear automation lock on completion or error
  if (state === CONFIG.FLOW_STATES.COMPLETE) {
    logger.info('Automation completed successfully, clearing lock');
    await storage.clearAutomationLock();

    // Record success
    const eventQueue = await storage.getEventQueue();
    await storage.recordSuccess(eventQueue?.length || 0);
  } else if (state === CONFIG.FLOW_STATES.ERROR) {
    logger.info('Automation finished with error, clearing lock');
    await storage.clearAutomationLock();
  }

  notifyStatusUpdate();
}

// Handle event discovery
async function handleEventDiscovered(events) {
  logger.info(`Discovered ${events.length} events`);
  await storage.setEventQueue(events);
  await storage.setState(CONFIG.FLOW_STATES.PROCESSING_EVENTS, {
    currentEvent: { index: 0, total: events.length }
  });
  notifyStatusUpdate();
}

// Handle event processing
async function handleProcessingEvent(data) {
  logger.info(`Processing event ${data.index + 1} of ${data.total}:`, data.event.name);
  await storage.setCurrentEvent(data);
  notifyStatusUpdate();
}

// Handle report ready for download
async function handleReportReady(reportData) {
  logger.info('Report ready for download:', reportData.metadata);

  try {
    await downloadReport(reportData);
    logger.info('Report downloaded successfully');
  } catch (error) {
    logger.error('Failed to download report:', error);

    // FIX: Clear lock on download failure
    await storage.cleanupAutomation();

    await storage.recordError({
      code: CONFIG.ERROR_CODES.DOWNLOAD_FAILED,
      message: error.message,
      context: reportData.metadata
    });

    await storage.setState(CONFIG.FLOW_STATES.ERROR);
    notifyStatusUpdate();
  }
}

// Download report
async function downloadReport(reportData) {
  const filename = await generateFilename(reportData.metadata, reportData.url);

  // Convert HTML to data URL (works in service workers)
  // Encode to base64 to handle any special characters
  const base64Html = btoa(unescape(encodeURIComponent(reportData.html)));
  const dataUrl = `data:text/html;base64,${base64Html}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: `Eventim_Reports/${filename}`,
    saveAs: false,
    conflictAction: 'uniquify'
  });

  logger.info('Download initiated:', filename);
}

// Generate filename from template
async function generateFilename(metadata, reportUrl) {
  const settings = await storage.getSettings();
  const pattern = settings.filenamePattern || CONFIG.DEFAULTS.FILENAME_PATTERN;

  // Parse dates from URL
  const dateRange = parseDateRange(reportUrl, metadata.dateRange);

  // Sanitize event name
  const eventName = sanitizeFilename(metadata.eventName || 'Unknown_Event');

  // Format timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];

  // Format date
  const date = new Date().toISOString().split('T')[0];

  // Extract report ID from filename
  const reportId = metadata.filename?.replace('.html', '').split('_').pop() || '';

  // Replace variables in pattern
  let filename = pattern
    .replace('{eventName}', eventName)
    .replace('{dateRange}', dateRange)
    .replace('{timestamp}', timestamp)
    .replace('{date}', date)
    .replace('{reportId}', reportId);

  // Ensure .html extension
  if (!filename.endsWith('.html')) {
    filename += '.html';
  }

  return filename;
}

// Parse date range from URL or text
function parseDateRange(url, fallbackText) {
  try {
    const urlObj = new URL(url);
    const beginDate = urlObj.searchParams.get('BeginDate');
    const endDate = urlObj.searchParams.get('EndDate');

    if (beginDate && endDate) {
      // Decode .NET ticks
      const start = decodeEventimDate(beginDate);
      const end = decodeEventimDate(endDate);
      return `${formatDate(start)}_${formatDate(end)}`;
    }
  } catch (error) {
    logger.warn('Failed to parse dates from URL:', error);
  }

  // Fallback: parse from text
  if (fallbackText) {
    const dateMatch = fallbackText.match(/(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
    if (dateMatch) {
      return `${dateMatch[1].replace(/\./g, '')}_${dateMatch[2].replace(/\./g, '')}`;
    }
  }

  return 'unknown_dates';
}

// Decode .NET ticks to JavaScript Date
function decodeEventimDate(ticks) {
  const ticksBigInt = BigInt(ticks);
  const ms = Number((ticksBigInt - CONFIG.DATE_CONVERSION.TICKS_SINCE_1970) / CONFIG.DATE_CONVERSION.TICKS_TO_MS);
  return new Date(ms);
}

// Format date as YYYYMMDD
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// Sanitize filename
function sanitizeFilename(name) {
  return name
    .replace(/[^a-z0-9äöüß\s\-_]/gi, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}

// Handle errors
async function handleError(error, context) {
  logger.error('Error occurred:', error, context);

  await storage.recordError({
    code: error.code || CONFIG.ERROR_CODES.UNKNOWN,
    message: error.message,
    context
  });

  await storage.setState(CONFIG.FLOW_STATES.ERROR);

  // CLEAR AUTOMATION LOCK on error
  await storage.clearAutomationLock();

  // Show notification if enabled
  const settings = await storage.getSettings();
  if (settings.notifications.errors) {
    showNotification('error', error.message);
  }

  notifyStatusUpdate();
}

// Show notification
function showNotification(type, message) {
  const titles = {
    error: 'Eventim Download Error',
    success: 'Eventim Download Complete',
    info: 'Eventim Downloader'
  };

  chrome.notifications.create({
    type: 'basic',
    iconUrl: '../icons/icon48.png',
    title: titles[type] || titles.info,
    message: message
  });
}

// Notify popup of status update
function notifyStatusUpdate() {
  chrome.runtime.sendMessage({
    type: CONFIG.MESSAGE_TYPES.STATUS_UPDATE
  }).catch(() => {
    // Popup might not be open, ignore error
  });
}

// Update schedule based on settings
async function updateSchedule(schedule) {
  logger.info('Updating schedule:', schedule);

  // Clear existing alarm
  await chrome.alarms.clear('eventim-download');

  if (!schedule.enabled) {
    logger.info('Schedule disabled');
    return;
  }

  // Calculate period in minutes
  let periodInMinutes;
  switch (schedule.frequency) {
    case 'daily':
      periodInMinutes = 24 * 60;
      break;
    case 'weekly':
      periodInMinutes = 7 * 24 * 60;
      break;
    case 'custom':
      periodInMinutes = schedule.customHours * 60;
      break;
    default:
      periodInMinutes = 24 * 60;
  }

  // Create alarm
  await chrome.alarms.create('eventim-download', {
    periodInMinutes: periodInMinutes,
    delayInMinutes: periodInMinutes // First run after this delay
  });

  logger.info(`Schedule set to run every ${periodInMinutes} minutes`);
}

// Listen for settings changes
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' && changes.schedule) {
    await updateSchedule(changes.schedule.newValue);
  }
});

// Initialize schedule on startup
(async () => {
  const schedule = await storage.getSchedule();
  await updateSchedule(schedule);
})();

// Clean up stale state on startup
(async () => {
  const lockStatus = await storage.checkAutomationLock();
  const currentState = await storage.getCurrentState();

  if (!lockStatus.active) {
    // No active automation, clear any stale flow state
    if (currentState !== CONFIG.FLOW_STATES.IDLE &&
        currentState !== CONFIG.FLOW_STATES.COMPLETE) {
      logger.info('Clearing stale flow state from previous session');
      await storage.cleanupAutomation();
    }
  } else {
    // Automation is active, check if stuck in ANY state
    const elapsed = Date.now() - lockStatus.startTime;

    // Check ALL states, not just READY_TO_START
    if (elapsed > CONFIG.AUTOMATION.STUCK_DETECTION_MS) {
      logger.warn(`Automation stuck in ${currentState} for ${Math.floor(elapsed / 1000)}s, clearing lock`);
      await storage.cleanupAutomation();
      await storage.setState(CONFIG.FLOW_STATES.ERROR, {
        message: `Automation stuck in ${currentState} state`
      });
    }
  }
})();

logger.info('Background service worker initialized');
