// Popup UI logic for Eventim Report Downloader

// Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const progressText = document.getElementById('progressText');
const downloadBtn = document.getElementById('downloadBtn');
const btnText = document.getElementById('btnText');
const lastRunEl = document.getElementById('lastRun');
const scheduleEl = document.getElementById('schedule');
const reportCountEl = document.getElementById('reportCount');
const optionsLink = document.getElementById('optionsLink');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  updateUI();

  // Manual trigger button
  downloadBtn.addEventListener('click', handleDownloadClick);

  // Options link
  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Listen for status updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATUS_UPDATE') {
      updateUI();
    }
  });

  // Update UI every few seconds
  setInterval(updateUI, 3000);
});

async function updateUI() {
  try {
    // Get state from storage
    const state = await chrome.storage.local.get([
      'flowState',  // Use ONLY flowState now
      'currentEvent',
      'lastRun'
    ]);

    // Get settings
    const settings = await chrome.storage.sync.get(['schedule']);

    // Update status
    updateStatus(state);

    // Update last run
    updateLastRun(state.lastRun);

    // Update schedule
    updateSchedule(settings.schedule);

    // Update report count
    updateReportCount(state.lastRun);

  } catch (error) {
    console.error('Failed to update UI:', error);
  }
}

function updateStatus(state) {
  const currentState = state.flowState || 'idle';  // Use ONLY flowState
  const currentEvent = state.currentEvent;

  // Reset classes
  statusDot.className = 'status-dot';

  switch (currentState) {
    case 'idle':
    case 'ready_to_start':
      statusDot.classList.add('idle');
      statusText.textContent = 'Idle';
      progressText.textContent = '';
      downloadBtn.disabled = false;
      btnText.textContent = 'Download Reports Now';
      break;

    case 'navigating_to_salestrend':
      statusDot.classList.add('running');
      statusText.textContent = 'Navigating...';
      progressText.textContent = 'Opening sales report page';
      downloadBtn.disabled = true;
      btnText.textContent = 'Running...';
      break;

    case 'processing_events':
      statusDot.classList.add('running');
      statusText.textContent = 'Processing events...';

      if (currentEvent) {
        const { index = 0, total = 0 } = currentEvent;
        progressText.textContent = `Processing event ${index + 1} of ${total}`;
      } else {
        progressText.textContent = 'Processing events';
      }

      downloadBtn.disabled = true;
      btnText.textContent = 'Running...';
      break;

    case 'complete':
      statusDot.classList.add('complete');
      statusText.textContent = 'Complete';
      progressText.textContent = 'All reports downloaded';
      downloadBtn.disabled = false;
      btnText.textContent = 'Download Reports Now';
      break;

    case 'error':
      statusDot.classList.add('error');
      statusText.textContent = 'Error';
      progressText.textContent = 'Check console for details';
      downloadBtn.disabled = false;
      btnText.textContent = 'Try Again';
      break;

    default:
      statusDot.classList.add('idle');
      statusText.textContent = 'Unknown';
      progressText.textContent = '';
      downloadBtn.disabled = false;
      btnText.textContent = 'Download Reports Now';
  }
}

function updateLastRun(lastRun) {
  if (!lastRun || !lastRun.timestamp) {
    lastRunEl.textContent = 'Never';
    return;
  }

  const date = new Date(lastRun.timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let timeAgo;
  if (diffMins < 1) {
    timeAgo = 'Just now';
  } else if (diffMins < 60) {
    timeAgo = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    timeAgo = `${diffHours}h ago`;
  } else {
    timeAgo = `${diffDays}d ago`;
  }

  lastRunEl.textContent = timeAgo;
  lastRunEl.title = date.toLocaleString();
}

function updateSchedule(schedule) {
  if (!schedule || !schedule.enabled) {
    scheduleEl.textContent = 'Disabled';
    return;
  }

  switch (schedule.frequency) {
    case 'daily':
      scheduleEl.textContent = 'Daily';
      break;
    case 'weekly':
      scheduleEl.textContent = 'Weekly';
      break;
    case 'custom':
      scheduleEl.textContent = `Every ${schedule.customHours}h`;
      break;
    default:
      scheduleEl.textContent = 'Enabled';
  }
}

function updateReportCount(lastRun) {
  if (!lastRun || lastRun.reportsDownloaded === undefined) {
    reportCountEl.textContent = '0';
    return;
  }

  reportCountEl.textContent = lastRun.reportsDownloaded;

  if (lastRun.errors && lastRun.errors.length > 0) {
    reportCountEl.textContent += ` (${lastRun.errors.length} errors)`;
  }
}

async function handleDownloadClick() {
  // Check if automation already running
  try {
    // Check if CONFIG is loaded
    if (typeof CONFIG === 'undefined' || !CONFIG.AUTOMATION) {
      console.warn('CONFIG not loaded yet');
    } else {
      const lockData = await chrome.storage.local.get([CONFIG.AUTOMATION.LOCK_KEY]);

      if (lockData[CONFIG.AUTOMATION.LOCK_KEY]) {
        console.log('Automation already in progress');
        return;
      }
    }
  } catch (error) {
    console.warn('Failed to check automation lock:', error);
  }

  // Send manual trigger message to background
  chrome.runtime.sendMessage({
    type: 'MANUAL_TRIGGER'
  });

  // Immediately update UI to show running state
  statusDot.className = 'status-dot running';
  statusText.textContent = 'Starting...';
  progressText.textContent = 'Initializing download';
  downloadBtn.disabled = true;
  btnText.textContent = 'Running...';
}
