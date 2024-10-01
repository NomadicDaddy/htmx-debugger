/* eslint-env worker */

let connections = {};
let messageQueue = [];
let isProcessingQueue = false;
let messageCounter = 0;
const MAX_QUEUE_SIZE = 1000;
const RATE_LIMIT_INTERVAL = 1000; // 1 second
const MAX_MESSAGES_PER_INTERVAL = 100;

let heartbeatIntervals = {};

function logWithTimestamp(message, data) {
	console.log(`[${new Date().toISOString()}] ${message}`, data);
}

function processMessageQueue() {
	if (isProcessingQueue || messageQueue.length === 0) return;

	isProcessingQueue = true;
	const startTime = Date.now();
	let processedCount = 0;

	while (messageQueue.length > 0 && processedCount < MAX_MESSAGES_PER_INTERVAL) {
		const { message, sender, sendResponse } = messageQueue.shift();
		try {
			handleMessage(message, sender, sendResponse);
			messageCounter++;
		} catch (error) {
			console.error('Error processing message:', error);
			reportError(error);
		}
		processedCount++;

		if (Date.now() - startTime >= RATE_LIMIT_INTERVAL) {
			break;
		}
	}

	isProcessingQueue = false;

	if (messageQueue.length > 0) {
		setTimeout(processMessageQueue, RATE_LIMIT_INTERVAL);
	}

	logWithTimestamp(`Processed ${processedCount} messages. Total messages: ${messageCounter}`);
}

function queueMessage(message, sender, sendResponse) {
	if (messageQueue.length >= MAX_QUEUE_SIZE) {
		logWithTimestamp('Message queue full. Dropping oldest message.');
		messageQueue.shift();
	}
	messageQueue.push({ message, sender, sendResponse });
	processMessageQueue();
}

function handleMessage(request, sender, sendResponse) {
	logWithTimestamp('Processing message:', request);

	if (sender.tab) {
		const tabId = sender.tab.id;
		if (tabId in connections) {
			if (request.type === 'HTMX_EVENT' || request.type.startsWith('htmx:')) {
				logWithTimestamp(`Forwarding htmx event to panel for tab ${tabId}:`, request);
				connections[tabId].postMessage({
					type: 'HTMX_EVENT_FOR_PANEL',
					data: request.data, // Ensure we're sending the full data
				});
				logWithTimestamp(`htmx event sent to panel for tab ${tabId}`);
			} else {
				// Only forward non-CONNECTION_TEST messages to the panel
				if (request.type !== 'CONNECTION_TEST') {
					logWithTimestamp(`Forwarding message to panel for tab ${tabId}:`, request);
					connections[tabId].postMessage(request);
					logWithTimestamp(`Message sent to panel for tab ${tabId}`);
				} else {
					logWithTimestamp(`Received CONNECTION_TEST from tab ${tabId}`);
				}
			}
		} else {
			logWithTimestamp('Tab not found in connection list:', tabId);
		}
	} else if (request.type === 'TEST') {
		logWithTimestamp('Received test message:', request);
		Object.values(connections).forEach((port) => {
			port.postMessage(request);
			logWithTimestamp('Test message sent to panel');
		});
	} else {
		logWithTimestamp('sender.tab not defined and not a test message.');
	}

	// Always send a response to avoid timeouts
	if (sendResponse) {
		sendResponse({ status: 'Message processed' });
	}
}

function startHeartbeat(tabId) {
	if (heartbeatIntervals[tabId]) {
		clearInterval(heartbeatIntervals[tabId]);
	}
	heartbeatIntervals[tabId] = setInterval(() => {
		// Changed to setInterval (self is already recognized)
		if (connections[tabId]) {
			connections[tabId].postMessage({ type: 'HEARTBEAT' });
		} else {
			clearInterval(heartbeatIntervals[tabId]);
			delete heartbeatIntervals[tabId];
		}
	}, 5000); // Send heartbeat every 5 seconds
}

// Listen for connections from the devtools panel
chrome.runtime.onConnect.addListener(function (port) {
	if (port.name !== 'panel') return;

	const extensionListener = function (message) {
		if (message.name === 'init') {
			connections[message.tabId] = port;
			logWithTimestamp(`Panel connected for tab ${message.tabId}`);
			startHeartbeat(message.tabId);
		}
	};

	port.onMessage.addListener(extensionListener);

	port.onDisconnect.addListener(function (disconnectedPort) {
		port.onMessage.removeListener(extensionListener);
		const tabs = Object.keys(connections);
		for (let i = 0, len = tabs.length; i < len; i++) {
			if (connections[tabs[i]] === disconnectedPort) {
				logWithTimestamp(`Panel disconnected for tab ${tabs[i]}`);
				delete connections[tabs[i]];
				clearInterval(heartbeatIntervals[tabs[i]]);
				delete heartbeatIntervals[tabs[i]];
				break;
			}
		}
	});
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
	// Use queueMessage instead of directly calling handleMessage
	queueMessage(request, sender, sendResponse);
	return true; // Indicate that the response is sent asynchronously
});

logWithTimestamp('Background service worker loaded');

// Keep the service worker alive and manage periodic tasks
chrome.runtime.onInstalled.addListener(() => {
	console.log('Extension installed or updated');
	chrome.alarms.create('keep-alive', { periodInMinutes: 1 });
	chrome.alarms.create('reset-counter', { periodInMinutes: 60 }); // Reset counter every hour
	chrome.alarms.create('log-stats', { periodInMinutes: 5 }); // Log stats every 5 minutes
});

chrome.runtime.onUpdateAvailable.addListener(() => {
	console.log('Extension update available. Reloading...');
	chrome.runtime.reload();
});

chrome.alarms.onAlarm.addListener((alarm) => {
	switch (alarm.name) {
		case 'keep-alive':
			logWithTimestamp('Keep-alive ping');
			break;
		case 'reset-counter':
			logWithTimestamp(`Resetting message counter. Previous count: ${messageCounter}`);
			messageCounter = 0;
			break;
		case 'log-stats':
			logWithTimestamp(`Current message count: ${messageCounter}`);
			logWithTimestamp(`Current queue size: ${messageQueue.length}`);
			break;
	}
});

function reportError(error) {
	console.error('Error in background script:', error);
	Object.values(connections).forEach((port) => {
		port.postMessage({ type: 'ERROR', error: error.message, stack: error.stack });
	});
}

// Global error handling
globalThis.addEventListener('error', (event) => {
	// Changed from self to globalThis
	reportError(event.error);
});

globalThis.addEventListener('unhandledrejection', (event) => {
	// Changed from self to globalThis
	reportError(event.reason);
});

// Example of avoiding window usage in background script
chrome.runtime.onInstalled.addListener(() => {
	console.log('Extension installed');
});

// If you need to communicate with content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'heartbeat') {
		// Handle heartbeat message
		sendResponse({ status: 'alive' });
	}

	if (message.type === 'HTMX_EVENT') {
		chrome.runtime.sendMessage({
			type: 'HTMX_EVENT_FOR_PANEL',
			data: message.data,
		});
	}
});
