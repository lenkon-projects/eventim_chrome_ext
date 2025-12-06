// Logging utility for Eventim Report Downloader extension

class Logger {
  constructor(context = 'EventimExt') {
    this.context = context;
    this.prefix = `[${context}]`;
  }

  info(...args) {
    console.log(this.prefix, ...args);
  }

  warn(...args) {
    console.warn(this.prefix, ...args);
  }

  error(...args) {
    console.error(this.prefix, ...args);
  }

  debug(...args) {
    console.debug(this.prefix, ...args);
  }

  group(label) {
    console.group(`${this.prefix} ${label}`);
  }

  groupEnd() {
    console.groupEnd();
  }

  table(data) {
    console.table(data);
  }

  time(label) {
    console.time(`${this.prefix} ${label}`);
  }

  timeEnd(label) {
    console.timeEnd(`${this.prefix} ${label}`);
  }
}

// Create default logger instances for different contexts
const createLogger = (context) => new Logger(context);

// Make Logger available globally
if (typeof window !== 'undefined') {
  window.Logger = Logger;
  window.createLogger = createLogger;
  window.logger = new Logger('EventimExt');
}

// For service worker (background)
if (typeof globalThis !== 'undefined') {
  globalThis.Logger = Logger;
  globalThis.createLogger = createLogger;
  globalThis.logger = new Logger('Background');
}
