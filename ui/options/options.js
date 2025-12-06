// Options page logic for Eventim Report Downloader

// Elements
const autoDownloadEnabled = document.getElementById('autoDownloadEnabled');
const intervalValue = document.getElementById('intervalValue');
const intervalUnit = document.getElementById('intervalUnit');
const syncMode = document.getElementById('syncMode');
const apiSettings = document.getElementById('apiSettings');
const downloadSettings = document.getElementById('downloadSettings');
const apiBearerToken = document.getElementById('apiBearerToken');
const testApiBtn = document.getElementById('testApiBtn');
const apiTestStatus = document.getElementById('apiTestStatus');
const filenamePattern = document.getElementById('filenamePattern');
const delayMin = document.getElementById('delayMin');
const delayMax = document.getElementById('delayMax');
const retryAttempts = document.getElementById('retryAttempts');
const notifyCompletion = document.getElementById('notifyCompletion');
const notifyErrors = document.getElementById('notifyErrors');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');

// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSettings);

// Save button
saveBtn.addEventListener('click', saveSettings);

// Sync mode change
syncMode.addEventListener('change', toggleSettingsSections);

// Test API button
testApiBtn.addEventListener('click', testApiConnection);

// Load settings from storage
async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get([
      'schedule',
      'filenamePattern',
      'delays',
      'retryAttempts',
      'notifications',
      'syncMode',
      'apiBearerToken'
    ]);

    // Schedule settings
    if (settings.schedule) {
      autoDownloadEnabled.checked = settings.schedule.enabled || false;
      intervalValue.value = settings.schedule.intervalValue || 60;
      intervalUnit.value = settings.schedule.intervalUnit || 'minutes';
    }

    // Sync mode
    syncMode.value = settings.syncMode || 'download';
    apiBearerToken.value = settings.apiBearerToken || '';
    toggleSettingsSections();

    // Filename pattern
    filenamePattern.value = settings.filenamePattern || '{eventName}_{dateRange}_{timestamp}.html';

    // Delays
    if (settings.delays) {
      delayMin.value = settings.delays.min || 500;
      delayMax.value = settings.delays.max || 2000;
    }

    // Retry attempts
    retryAttempts.value = settings.retryAttempts !== undefined ? settings.retryAttempts : 3;

    // Notifications
    if (settings.notifications) {
      notifyCompletion.checked = settings.notifications.completion !== false;
      notifyErrors.checked = settings.notifications.errors !== false;
    } else {
      notifyCompletion.checked = true;
      notifyErrors.checked = true;
    }

  } catch (error) {
    console.error('Failed to load settings:', error);
    showSaveStatus('Failed to load settings', 'error');
  }
}

// Save settings to storage
async function saveSettings() {
  try {
    // Validate inputs
    if (parseInt(delayMin.value) > parseInt(delayMax.value)) {
      showSaveStatus('Min delay must be less than max delay', 'error');
      return;
    }

    const settings = {
      schedule: {
        enabled: autoDownloadEnabled.checked,
        intervalValue: parseInt(intervalValue.value) || 60,
        intervalUnit: intervalUnit.value
      },
      syncMode: syncMode.value,
      apiBearerToken: apiBearerToken.value || '',
      filenamePattern: filenamePattern.value || '{eventName}_{dateRange}_{timestamp}.html',
      delays: {
        min: parseInt(delayMin.value) || 500,
        max: parseInt(delayMax.value) || 2000
      },
      retryAttempts: parseInt(retryAttempts.value) || 3,
      notifications: {
        completion: notifyCompletion.checked,
        errors: notifyErrors.checked
      }
    };

    // Save to storage
    await chrome.storage.sync.set(settings);

    showSaveStatus('Settings saved successfully', 'success');

    // Schedule will be updated automatically by background script
    // via storage.onChanged listener

  } catch (error) {
    console.error('Failed to save settings:', error);
    showSaveStatus('Failed to save settings', 'error');
  }
}

// Show save status message
function showSaveStatus(message, type) {
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${type}`;

  // Clear after 3 seconds
  setTimeout(() => {
    saveStatus.textContent = '';
    saveStatus.className = 'save-status';
  }, 3000);
}

// Toggle visibility of settings sections based on sync mode
function toggleSettingsSections() {
  const isApiMode = syncMode.value === 'api';
  apiSettings.style.display = isApiMode ? 'block' : 'none';
  downloadSettings.style.display = isApiMode ? 'none' : 'block';
}

// Test API connection
async function testApiConnection() {
  try {
    apiTestStatus.textContent = 'Testing...';
    apiTestStatus.className = 'test-status info';

    const token = apiBearerToken.value;
    if (!token) {
      showApiTestStatus('Please enter a bearer token', 'error');
      return;
    }

    const response = await fetch('https://scrapper.liorizhakidrums.com/api/eventim/parse-and-sync', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: 'https://webreporting.eventim.de/test' })
    });

    if (response.ok) {
      showApiTestStatus('Connection successful!', 'success');
    } else if (response.status === 401 || response.status === 403) {
      showApiTestStatus('Authentication failed', 'error');
    } else {
      showApiTestStatus(`Error: ${response.status}`, 'error');
    }

  } catch (error) {
    showApiTestStatus(`Connection failed: ${error.message}`, 'error');
  }
}

// Show API test status message
function showApiTestStatus(message, type) {
  apiTestStatus.textContent = message;
  apiTestStatus.className = `test-status ${type}`;
  setTimeout(() => {
    apiTestStatus.textContent = '';
  }, 5000);
}
