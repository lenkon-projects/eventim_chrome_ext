// Options page logic for Eventim Report Downloader

// Elements
const autoDownloadEnabled = document.getElementById('autoDownloadEnabled');
const frequency = document.getElementById('frequency');
const customHours = document.getElementById('customHours');
const customHoursGroup = document.getElementById('customHoursGroup');
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

// Show/hide custom hours input based on frequency selection
frequency.addEventListener('change', () => {
  if (frequency.value === 'custom') {
    customHoursGroup.style.display = 'block';
  } else {
    customHoursGroup.style.display = 'none';
  }
});

// Save button
saveBtn.addEventListener('click', saveSettings);

// Load settings from storage
async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get([
      'schedule',
      'filenamePattern',
      'delays',
      'retryAttempts',
      'notifications'
    ]);

    // Schedule settings
    if (settings.schedule) {
      autoDownloadEnabled.checked = settings.schedule.enabled || false;
      frequency.value = settings.schedule.frequency || 'daily';
      customHours.value = settings.schedule.customHours || 24;

      if (frequency.value === 'custom') {
        customHoursGroup.style.display = 'block';
      }
    }

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
        frequency: frequency.value,
        customHours: parseInt(customHours.value) || 24
      },
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
