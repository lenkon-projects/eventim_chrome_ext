// Storage wrapper for Eventim Report Downloader extension
// Provides convenient access to Chrome Storage API

class StorageManager {
  constructor() {
    this.local = chrome.storage.local;
    this.sync = chrome.storage.sync;
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
      currentState: state,
      flowState: state,
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
      'lastError'
    ]);
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
