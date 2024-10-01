console.log('Panel script loaded. Tab ID:', chrome.devtools.inspectedWindow.tabId);

let backgroundPageConnection = chrome.runtime.connect({
	name: 'panel',
});

let eventGroups = {};

let lastHeartbeatTime = Date.now();
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds (twice the polling interval)

function checkHeartbeat() {
	const currentTime = Date.now();
	if (currentTime - lastHeartbeatTime > HEARTBEAT_TIMEOUT) {
		console.log('Heartbeat timeout, attempting to reconnect...');
		updateConnectionStatus(false);
		initializePanel();
	}
}

backgroundPageConnection.onMessage.addListener(function (message) {
	console.log('Panel received message:', message);
	if (message.type === 'HEARTBEAT') {
		lastHeartbeatTime = Date.now();
		updateConnectionStatus(true);
	} else if (message.type === 'HTMX_DEBUG_INFO' || message.type === 'HTMX_EVENT' || message.type === 'HTMX_EVENT_FOR_PANEL') {
		console.log('Received htmx event:', message.data);
		if (message.data) {
			handleHtmxEvent(message.data);
		} else {
			console.warn('Received htmx event message without data:', message);
		}
	} else if (message.type === 'TEST') {
		console.log('Received test message:', message.data);
		addDebugMessage(`Test message received: ${message.data}`, 'text-blue-500');
		updateConnectionStatus(true);
	} else if (message.type === 'TEST_CONFIRMATION') {
		console.log('Received test confirmation:', message.data);
		addDebugMessage(`Test confirmation: ${message.data}`, 'text-green-500');
		updateConnectionStatus(true);
	} else if (message.type === 'ERROR') {
		console.error('Received error message:', message.error);
		addDebugMessage(`Error: ${message.error}`, 'text-red-500');
	} else if (message.type === 'CONNECTION_TEST') {
		console.log('Received CONNECTION_TEST message');
		// No need to update UI for CONNECTION_TEST
	} else {
		console.warn('Received unknown message type:', message);
	}
});

function initializePanel() {
	backgroundPageConnection.postMessage({
		name: 'init',
		tabId: chrome.devtools.inspectedWindow.tabId,
	});
	console.log('Panel initialized for tab:', chrome.devtools.inspectedWindow.tabId);
	lastHeartbeatTime = Date.now(); // Reset heartbeat time on initialization
}

function updateDebugInfo() {
	const debugInfo = document.getElementById('debug-info');
	debugInfo.innerHTML = '';

	Object.entries(eventGroups).forEach(([groupName, events]) => {
		const groupElement = createGroupElement(groupName, events);
		debugInfo.appendChild(groupElement);
	});
}

function createGroupElement(groupName, events) {
	const groupElement = document.createElement('div');
	groupElement.className = 'event-group mb-4 border border-gray-200 rounded-lg overflow-hidden';

	const groupHeader = document.createElement('h3');
	groupHeader.textContent = `Group: ${groupName} (${events.length} events)`;
	groupHeader.className = 'group-header collapsed text-lg font-semibold bg-gray-100 px-4 py-2 cursor-pointer hover:bg-gray-200 transition-colors duration-200';
	groupHeader.addEventListener('click', toggleGroup);

	groupElement.appendChild(groupHeader);

	const eventsContainer = document.createElement('div');
	eventsContainer.className = 'events-container hidden';

	events.forEach((event) => {
		const eventElement = createEventElement(event);
		eventsContainer.appendChild(eventElement);
	});

	groupElement.appendChild(eventsContainer);
	return groupElement;
}

function createEventElement(eventData) {
	const eventElement = document.createElement('div');
	eventElement.className = 'htmx-event border-t border-gray-200 mb-4';

	const eventHeader = document.createElement('h4');
	eventHeader.textContent = `${eventData.type || 'Unknown Event'} (${eventData.timestamps.join(', ')})`;
	eventHeader.className = 'event-header collapsed text-md font-medium bg-gray-50 px-4 py-2 cursor-pointer hover:bg-gray-100 transition-colors duration-200';
	eventHeader.addEventListener('click', toggleEvent);

	const eventContent = document.createElement('div');
	eventContent.className = 'event-content hidden px-4 py-2 bg-white';

	if (eventData.target) {
		const targetInfo = document.createElement('div');
		targetInfo.innerHTML = `
			<h5 class="font-bold mt-2">Target Element:</h5>
			<p>Tag: ${eventData.target.tagName || 'N/A'}</p>
			<p>ID: ${eventData.target.id || 'N/A'}</p>
			<p>Class: ${eventData.target.className || 'N/A'}</p>
		`;

		// Explicitly handle HX attributes
		if (eventData.target.hxAttributes && eventData.target.hxAttributes.length > 0) {
			const hxAttributesHeader = document.createElement('h5');
			hxAttributesHeader.textContent = 'HX Attributes:';
			hxAttributesHeader.className = 'font-bold mt-2 text-blue-600';
			targetInfo.appendChild(hxAttributesHeader);

			const hxAttributesList = document.createElement('ul');
			hxAttributesList.className = 'list-disc pl-5';
			eventData.target.hxAttributes.forEach((attr) => {
				const li = document.createElement('li');
				li.textContent = `${attr.name}: ${attr.value}`;
				li.className = 'text-blue-600';
				hxAttributesList.appendChild(li);
			});
			targetInfo.appendChild(hxAttributesList);
		} else {
			targetInfo.innerHTML += '<p class="text-gray-500">No HX attributes found.</p>';
		}

		eventContent.appendChild(targetInfo);
	}

	const fullDataHeader = document.createElement('h5');
	fullDataHeader.textContent = 'Full Event Data';
	fullDataHeader.className = 'font-bold mt-4 cursor-pointer';
	fullDataHeader.addEventListener('click', toggleFullData);

	const fullDataContent = document.createElement('div');
	fullDataContent.className = 'hidden';

	const fullDataPre = document.createElement('pre');
	fullDataPre.className = 'mt-2 p-2 bg-gray-100 rounded overflow-x-auto text-sm';
	fullDataPre.textContent = JSON.stringify(eventData, null, 2);

	fullDataContent.appendChild(fullDataPre);

	eventContent.appendChild(fullDataHeader);
	eventContent.appendChild(fullDataContent);

	eventElement.appendChild(eventHeader);
	eventElement.appendChild(eventContent);
	return eventElement;
}

function toggleFullData(event) {
	const header = event.target;
	const content = header.nextElementSibling;
	content.classList.toggle('hidden');
}

function toggleGroup(event) {
	const header = event.target;
	const group = header.parentElement;
	const eventsContainer = group.querySelector('.events-container');

	eventsContainer.classList.toggle('hidden');

	// Update arrow icon based on the visibility of the events container
	if (eventsContainer.classList.contains('hidden')) {
		header.classList.add('collapsed');
	} else {
		header.classList.remove('collapsed');
	}
}

function toggleEvent(event) {
	const header = event.target;
	const eventElement = header.parentElement;
	const content = eventElement.querySelector('.event-content');

	content.classList.toggle('hidden');

	// Update arrow icon based on the visibility of the event content
	if (content.classList.contains('hidden')) {
		header.classList.add('collapsed');
	} else {
		header.classList.remove('collapsed');
	}
}

document.getElementById('search-input').addEventListener('input', function (e) {
	const searchTerm = e.target.value.toLowerCase();
	document.querySelectorAll('.htmx-event').forEach((event) => {
		const eventContent = event.querySelector('.event-content').textContent.toLowerCase();
		const isVisible = eventContent.includes(searchTerm);
		event.style.display = isVisible ? 'block' : 'none';
		const group = event.closest('.event-group');
		group.style.display = group.querySelector('.htmx-event[style="display: block;"]') ? 'block' : 'none';
	});
});

document.getElementById('clear-button').addEventListener('click', function () {
	document.getElementById('debug-info').innerHTML = '<p class="text-gray-500 text-center py-4">Debug information cleared. Waiting for new htmx events...</p>';
	eventGroups = {};
});

document.querySelectorAll('.filter-button').forEach((button) => {
	button.addEventListener('click', function () {
		document.querySelectorAll('.filter-button').forEach((btn) => {
			btn.classList.remove('active', 'bg-blue-500', 'text-white');
			btn.classList.add('bg-gray-200', 'text-gray-700');
		});
		this.classList.remove('bg-gray-200', 'text-gray-700');
		this.classList.add('active', 'bg-blue-500', 'text-white');
		const filter = this.dataset.filter;
		filterDebugInfo(filter);
	});
});

function filterDebugInfo(filter) {
	document.querySelectorAll('.htmx-event').forEach((event) => {
		const eventType = event.querySelector('.event-header').textContent;
		let display = 'none';

		if (filter === 'ALL') {
			display = 'block';
		} else if (filter === 'REQUEST' && (eventType.includes('beforeRequest') || eventType.includes('beforeSend') || eventType.includes('xhr:loadstart'))) {
			display = 'block';
		} else if (filter === 'RESPONSE' && (eventType.includes('afterRequest') || eventType.includes('xhr:loadend') || eventType.includes('load'))) {
			display = 'block';
		}

		event.style.display = display;

		const group = event.closest('.event-group');
		group.style.display = group.querySelector('.htmx-event[style="display: block;"]') ? 'block' : 'none';
	});
}

function addDebugMessage(message, className = 'text-gray-500') {
	const debugInfo = document.getElementById('debug-info');
	const messageElement = document.createElement('p');
	messageElement.className = `${className} py-1`;
	messageElement.textContent = message;
	debugInfo.appendChild(messageElement);
}

function sendTestMessage() {
	const testMessage = {
		name: 'test',
		tabId: chrome.devtools.inspectedWindow.tabId,
		data: 'Test message from panel',
	};
	backgroundPageConnection.postMessage(testMessage);
	// addDebugMessage('Test message sent to background script', 'text-green-500');
	console.log('Test message sent:', testMessage);
}

function updateConnectionStatus(status) {
	const statusContainer = document.getElementById('connection-status-container');
	if (statusContainer) {
		statusContainer.innerHTML = '';
		const statusElement = document.createElement('span');
		statusElement.textContent = status ? 'Connected' : 'Disconnected';
		statusElement.className = status ? 'text-green-500' : 'text-red-500';
		statusContainer.appendChild(statusElement);
	}
}

function verifyConnection() {
	sendTestMessage();
	checkHeartbeat();
}

// Initialize the panel
document.addEventListener('DOMContentLoaded', function () {
	const debugInfo = document.getElementById('debug-info');
	if (debugInfo) {
		debugInfo.innerHTML = '<p class="text-gray-500 text-center py-4">htmx-debugger initialized. Waiting for events...</p>';
	} else {
		console.error('Debug info element not found on DOMContentLoaded');
	}

	initializePanel();
	verifyConnection();

	// Start periodic connection check and heartbeat check
	setInterval(verifyConnection, 30000); // Check every 30 seconds
});

// Handle page reloads
chrome.devtools.network.onNavigated.addListener(function () {
	console.log('Page reloaded, reinitializing htmx-debugger');
	addDebugMessage('Page reloaded. Waiting for new htmx events...', 'text-yellow-500');
	eventGroups = {};
	initializePanel();
});

// Error handling for runtime errors
chrome.runtime.onMessage.addListener(function (message) {
	if (message.type === 'ERROR') {
		console.error('Runtime error:', message.error);
		addDebugMessage(`Error: ${message.error}`, 'text-red-500');
	}
});

// Add configurable option to suppress empty events
const SUPPRESS_EMPTY_EVENTS = true; // Set to false to allow all events

function handleHtmxEvent(event) {
	if (SUPPRESS_EMPTY_EVENTS && !event.target && (!event.detail || Object.keys(event.detail).length === 0)) {
		console.log('Suppressed empty event:', event);
		return;
	}

	console.log('Handling htmx event:', event);

	// Check if event is a valid object
	if (typeof event !== 'object' || event === null) {
		console.warn('Received invalid event:', event);
		return;
	}

	// Determine the event type and timestamp
	let eventType = event.type || (event.detail && event.detail.type) || 'unknown';
	let eventTimestamp = event.timestamp || new Date().toISOString();

	// Create a normalized event object
	let normalizedEvent = {
		type: eventType,
		timestamps: [eventTimestamp],
		target: event.target || event.detail?.target || null,
		detail: event.detail || null,
		// Add any other properties you want to preserve
	};

	let groupName = determineGroupName(normalizedEvent);

	if (!eventGroups[groupName]) {
		eventGroups[groupName] = [];
	}

	// Check if an event with the same type and target already exists
	let existingEvent = eventGroups[groupName].find((e) => e.type === normalizedEvent.type && JSON.stringify(e.target) === JSON.stringify(normalizedEvent.target));

	if (existingEvent) {
		// If it exists, add the new timestamp to the existing event
		existingEvent.timestamps.push(eventTimestamp);
	} else {
		// Otherwise, add the new event to the group
		eventGroups[groupName].push(normalizedEvent);
	}

	// Update the display
	updateDebugInfo();
}

function determineGroupName(event) {
	if (event.target && event.target.id) {
		return event.target.id;
	} else if (event.target && event.target.tagName) {
		return event.target.tagName.toLowerCase();
	} else if (event.type && event.type.startsWith('htmx:')) {
		// Instead of returning 'htmx', let's categorize based on the specific htmx event type
		return event.type.split(':')[1]; // This will return the part after 'htmx:'
	} else {
		return 'other';
	}
}
