// Storage wrapper for Eventim Report Downloader extension
// Provides convenient access to Chrome Storage API

class StorageManager {
  constructor() {
    this.local = chrome.storage.local;
    this.sync = chrome.storage.sync;
    // MV3 session storage - falls back to local if not available
    this.session = chrome.storage.session || chrome.storage.local;
  }

  // Local storage methods (for transient state)
  async getState() {
    const data = await this.local.get([
      'currentState',
      'flowState',
      'currentEvent',
      'eventQueue',
      'lastError',
      'lastRun'
    ]);
    return data;
  }

  async setState(state, data = {}) {
    await this.local.set({
      flowState: state,  // Use ONLY flowState, removed currentState
      ...data
    });
  }

  async setCurrentEvent(eventData) {
    await this.local.set({ currentEvent: eventData });
  }

  async setEventQueue(events) {
    await this.local.set({ eventQueue: events });
  }

  async getEventQueue() {
    const { eventQueue } = await this.local.get('eventQueue');
    return eventQueue || [];
  }

  async recordError(error) {
    const state = await this.getState();
    const errors = state.lastRun?.errors || [];
    errors.push({
      timestamp: new Date().toISOString(),
      ...error
    });

    await this.local.set({
      lastError: {
        timestamp: new Date().toISOString(),
        ...error
      },
      lastRun: {
        ...(state.lastRun || {}),
        errors
      }
    });
  }

  async recordSuccess(reportsCount) {
    await this.local.set({
      lastRun: {
        timestamp: new Date().toISOString(),
        status: 'success',
        reportsDownloaded: reportsCount,
        errors: []
      }
    });
  }

  async recordPartialSuccess(reportsCount, errors) {
    await this.local.set({
      lastRun: {
        timestamp: new Date().toISOString(),
        status: 'partial',
        reportsDownloaded: reportsCount,
        errors
      }
    });
  }

  // Sync storage methods (for persistent configuration)
  async getSettings() {
    const data = await this.sync.get([
      'schedule',
      'filenamePattern',
      'delays',
      'retryAttempts',
      'notifications'
    ]);

    // Return with defaults if not set
    return {
      schedule: data.schedule || CONFIG.DEFAULTS.SCHEDULE,
      filenamePattern: data.filenamePattern || CONFIG.DEFAULTS.FILENAME_PATTERN,
      delays: data.delays || CONFIG.DEFAULTS.DELAYS,
      retryAttempts: data.retryAttempts !== undefined ? data.retryAttempts : CONFIG.DEFAULTS.RETRY_ATTEMPTS,
      notifications: data.notifications || CONFIG.DEFAULTS.NOTIFICATIONS
    };
  }

  async saveSettings(settings) {
    await this.sync.set(settings);
  }

  async updateSchedule(schedule) {
    await this.sync.set({ schedule });
  }

  async getSchedule() {
    const { schedule } = await this.sync.get('schedule');
    return schedule || CONFIG.DEFAULTS.SCHEDULE;
  }

  // Utility methods
  async clear() {
    await this.local.clear();
  }

  async clearState() {
    await this.local.remove([
      'currentState',
      'flowState',
      'currentEvent',
      'eventQueue',
      'lastError',
      'status'
    ]);
  }

  // Helper to read state consistently
  async getCurrentState() {
    const { flowState } = await this.local.get('flowState');
    return flowState || CONFIG.FLOW_STATES.IDLE;
  }

  // Comprehensive cleanup for automation - clears lock, state, and event progress
  async cleanupAutomation() {
    // Clear automation lock
    await this.clearAutomationLock();

    // Clear flow state
    await this.clearState();

    // Clear event queue and progress
    await this.local.remove(['eventQueue', 'currentEvent', 'eventProgressIndex', 'eventProgressQueue']);
  }

  async get(key, useSync = false) {
    const storage = useSync ? this.sync : this.local;
    const data = await storage.get(key);
    return data[key];
  }

  async set(key, value, useSync = false) {
    const storage = useSync ? this.sync : this.local;
    await storage.set({ [key]: value });
  }

  // Automation lock management
  async setAutomationLock(trigger, tabId) {
    const sessionId = crypto.randomUUID();
    const lockData = {
      [CONFIG.AUTOMATION.LOCK_KEY]: true,
      [CONFIG.AUTOMATION.SESSION_ID_KEY]: sessionId,
      [CONFIG.AUTOMATION.TRIGGER_KEY]: trigger,
      [CONFIG.AUTOMATION.START_TIME_KEY]: Date.now(),
      [CONFIG.AUTOMATION.TAB_ID_KEY]: tabId
    };

    // Set in both session and local storage for reliability
    await Promise.all([
      this.session.set(lockData),
      this.local.set(lockData)
    ]);

    return sessionId;
  }

  async checkAutomationLock() {
    // Try session storage first
    let data = await this.session.get([
      CONFIG.AUTOMATION.LOCK_KEY,
      CONFIG.AUTOMATION.SESSION_ID_KEY,
      CONFIG.AUTOMATION.TRIGGER_KEY,
      CONFIG.AUTOMATION.START_TIME_KEY,
      CONFIG.AUTOMATION.TAB_ID_KEY
    ]);

    // Fall back to local storage if session is empty
    if (!data[CONFIG.AUTOMATION.LOCK_KEY]) {
      data = await this.local.get([
        CONFIG.AUTOMATION.LOCK_KEY,
        CONFIG.AUTOMATION.SESSION_ID_KEY,
        CONFIG.AUTOMATION.TRIGGER_KEY,
        CONFIG.AUTOMATION.START_TIME_KEY,
        CONFIG.AUTOMATION.TAB_ID_KEY
      ]);
    }

    const isActive = data[CONFIG.AUTOMATION.LOCK_KEY] || false;
    const startTime = data[CONFIG.AUTOMATION.START_TIME_KEY];

    // Check for timeout
    if (isActive && startTime) {
      const elapsed = Date.now() - startTime;
      if (elapsed > CONFIG.AUTOMATION.TIMEOUT_MS) {
        // Lock expired, clear it
        await this.clearAutomationLock();
        return { active: false, reason: 'timeout' };
      }
    }

    return {
      active: isActive,
      sessionId: data[CONFIG.AUTOMATION.SESSION_ID_KEY],
      trigger: data[CONFIG.AUTOMATION.TRIGGER_KEY],
      startTime: startTime,
      tabId: data[CONFIG.AUTOMATION.TAB_ID_KEY]
    };
  }

  async clearAutomationLock() {
    const keys = [
      CONFIG.AUTOMATION.LOCK_KEY,
      CONFIG.AUTOMATION.SESSION_ID_KEY,
      CONFIG.AUTOMATION.TRIGGER_KEY,
      CONFIG.AUTOMATION.START_TIME_KEY,
      CONFIG.AUTOMATION.TAB_ID_KEY
    ];

    // Clear from both storages
    await Promise.all([
      this.session.remove(keys),
      this.local.remove(keys)
    ]);
  }

  async updateAutomationTabId(tabId) {
    await Promise.all([
      this.session.set({ [CONFIG.AUTOMATION.TAB_ID_KEY]: tabId }),
      this.local.set({ [CONFIG.AUTOMATION.TAB_ID_KEY]: tabId })
    ]);
  }
}

// Create singleton instance
const storage = new StorageManager();

// Make storage available globally
if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
  window.storage = storage;
}

// For service worker (background)
if (typeof globalThis !== 'undefined') {
  globalThis.StorageManager = StorageManager;
  globalThis.storage = storage;
}
