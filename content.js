/* eslint-env browser */
(function () {
	const htmxDebugger = {
		isConnected: false,
		eventCounter: 0,
		maxEvents: 1000, // Maximum number of events to log before resetting
		lastResetTime: Date.now(),
		errorCount: 0,
		maxErrors: 50, // Maximum number of errors before triggering circuit breaker
		circuitBreakerTimeout: 60000, // 1 minute timeout for circuit breaker
		isCircuitBroken: false,
		reconnectAttempts: 0,
		maxReconnectAttempts: 5,
		reconnectDelay: 30000, // 30 seconds delay between reconnection attempts

		init: async function () {
			try {
				console.log('Initializing htmx-debugger...');
				if (!this.isExtensionEnvironment()) {
					console.warn('Not running in a Chrome extension environment.');
					return;
				}
				console.log('Extension environment valid, continuing initialization...');

				this.setupHtmxLogger();
				this.setupMessageListener();
				await this.verifyConnection();
				this.startConnectionCheck();

				// Only add the update listener if chrome.runtime is available
				if (chrome.runtime && chrome.runtime.onUpdateAvailable) {
					chrome.runtime.onUpdateAvailable.addListener(() => {
						console.log('Extension update available. Reloading...');
						chrome.runtime.reload();
					});
				}

				// Check if the extension is still valid
				if (!this.isExtensionValid()) {
					throw new Error('Extension context invalidated');
				}
				htmxEvents.forEach((event) => {
					document.body.addEventListener(event, this.logEvent.bind(this));
				});

				console.log('htmx event listeners set up');
			} catch (error) {
				console.error('Error during htmx-debugger initialization:', error);
				this.handleError(error);
				// Attempt to reinitialize after a delay
				setTimeout(() => this.init(), 5000);
			}
		},

		isExtensionEnvironment: function () {
			console.log('Checking extension environment...');
			if (typeof chrome === 'undefined') {
				console.warn('Chrome API is not available');
				return false;
			}
			if (!chrome.runtime) {
				console.warn('chrome.runtime is not available');
				return false;
			}
			try {
				chrome.runtime.getURL('');
				console.log('chrome.runtime.id exists:', !!chrome.runtime.id);
				return true;
			} catch (error) {
				console.warn('Extension context is invalid:', error.message);
				return false;
			}
		},

		isExtensionValid: function () {
			return this.isExtensionEnvironment() && chrome.runtime.id;
		},

		getElementInfo: function (element) {
			if (!element) return null;
			try {
				const attributes = Array.from(element.attributes || []).map((attr) => ({
					name: attr.name,
					value: attr.value,
				}));

				const hxAttributes = attributes.filter((attr) => attr.name.startsWith('hx-'));

				return {
					id: element.id || '',
					tagName: element.tagName || '',
					className: element.className || '',
					attributes: attributes,
					hxAttributes: hxAttributes.length > 0 ? hxAttributes : undefined,
				};
			} catch (error) {
				console.error('Error getting element info:', error);
				return { error: 'Failed to get element info' };
			}
		},

		getXhrInfo: function (xhr) {
			if (!xhr) return null;
			try {
				return {
					url: xhr.url || 'N/A',
					method: xhr.method || 'N/A',
					status: xhr.status || 'N/A',
					statusText: xhr.statusText || 'N/A',
				};
			} catch (error) {
				console.error('Error getting XHR info:', error);
				return { error: 'Failed to get XHR info' };
			}
		},

		logEvent: function (event) {
			if (this.isCircuitBroken) {
				console.warn('Circuit breaker active. Skipping event logging.');
				return;
			}

			if (this.eventCounter >= this.maxEvents) {
				const now = Date.now();
				if (now - this.lastResetTime < 60000) {
					// If less than a minute since last reset
					console.warn('Too many events logged in a short time. Skipping event logging.');
					return;
				}
				this.eventCounter = 0;
				this.lastResetTime = now;
			}

			this.eventCounter++;

			try {
				const eventInfo = {
					type: event.type,
					timestamp: new Date().toISOString(),
					target: this.getElementInfo(event.target),
					detail: event.detail ? JSON.parse(JSON.stringify(event.detail)) : null,
				};

				console.log('htmx Event captured:', eventInfo);
				console.log('HX Attributes:', eventInfo.target.hxAttributes);

				if (event.type.startsWith('htmx:xhr:') && event.detail && event.detail.xhr) {
					eventInfo.xhr = this.getXhrInfo(event.detail.xhr);
				}

				console.log('htmx Event:', eventInfo);
				this.sendMessage(eventInfo);
			} catch (error) {
				console.error('Error logging event:', error);
				this.handleError(error);
			}
		},

		sendMessage: function (data) {
			if (!this.isConnected) {
				console.warn('Not connected to background script. Attempting to reconnect...');
				this.verifyConnection();
				return;
			}

			try {
				console.log('Sending htmx debug info:', JSON.stringify(data, null, 2));
				chrome.runtime.sendMessage(
					{
						type: 'HTMX_EVENT',
						data: data,
					},
					(response) => {
						if (chrome.runtime.lastError) {
							console.error('Error sending message:', chrome.runtime.lastError);
							this.handleError(new Error(chrome.runtime.lastError.message));
							this.isConnected = false;
							this.attemptReconnection();
						} else {
							console.log('Message sent successfully:', response);
							this.reconnectAttempts = 0; // Reset reconnect attempts on successful message
						}
					}
				);
			} catch (error) {
				console.error('Error sending message:', error);
				this.handleError(error);
				this.isConnected = false;
				this.attemptReconnection();
			}
		},

		setupHtmxLogger: function () {
			if (window.htmx) {
				const originalProcess = window.htmx.process;
				let processingCounter = 0;
				const maxProcessingDepth = 100; // Prevent potential infinite loops

				window.htmx.process = (elt) => {
					if (processingCounter >= maxProcessingDepth) {
						console.error('Maximum processing depth reached. Possible infinite loop detected.');
						this.triggerCircuitBreaker();
						return;
					}

					processingCounter++;
					try {
						const processInfo = {
							type: 'htmx:process',
							timestamp: new Date().toISOString(),
							element: this.getElementInfo(elt),
						};
						this.sendMessage(processInfo);
						// Use spread operator to pass arguments
						return originalProcess.apply(window.htmx, [...arguments]);
					} finally {
						processingCounter--;
					}
				};
			} else {
				// console.warn('htmx not found on the page - some debugging features may not work.');
			}
		},

		setupMessageListener: function () {
			if (chrome.runtime && chrome.runtime.onMessage) {
				chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
					console.log('Content script received message:', message);
					if (message.type === 'TEST') {
						console.log('Received test message:', message.data);
						sendResponse({ status: 'Test message received by content script' });
						this.sendMessage({
							type: 'TEST_CONFIRMATION',
							data: 'Content script received test message',
						});
					}
					return true; // Indicates that the response is sent asynchronously
				});
			} else {
				console.warn('chrome.runtime.onMessage not available. Message listener not set up.');
			}
		},

		handleError: function (error) {
			console.error('htmx-debugger error:', error);
			this.errorCount++;

			if (this.errorCount >= this.maxErrors) {
				this.triggerCircuitBreaker();
			}

			// Check for the specific "Extension context invalidated" error
			if (error.message.includes('Extension context invalidated')) {
				this.handleExtensionInvalidated();
			} else {
				this.sendMessage({
					type: 'ERROR',
					error: error.message,
					stack: error.stack,
				});
			}
		},

		handleExtensionInvalidated: function () {
			console.warn('Extension context invalidated. Attempting to reconnect...');
			this.isConnected = false;
			// Instead of reloading, we'll try to reinitialize
			setTimeout(() => this.init(), 5000);
		},

		attemptReconnection: function () {
			if (this.reconnectAttempts < this.maxReconnectAttempts) {
				this.reconnectAttempts++;
				console.log(`Reconnection attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts}`);
				setTimeout(() => {
					this.verifyConnection();
				}, this.reconnectDelay);
			} else {
				console.error('Max reconnection attempts reached. Please reload the page.');
				this.triggerCircuitBreaker();
			}
		},

		triggerCircuitBreaker: function () {
			if (!this.isCircuitBroken) {
				console.warn('Circuit breaker triggered. Pausing htmx-debugger operations.');
				this.isCircuitBroken = true;
				setTimeout(() => {
					console.log('Circuit breaker reset. Resuming htmx-debugger operations.');
					this.isCircuitBroken = false;
					this.errorCount = 0;
					this.reconnectAttempts = 0;
					this.verifyConnection();
				}, this.circuitBreakerTimeout);
			}
		},

		verifyConnection: function () {
			return new Promise((resolve) => {
				const checkConnection = () => {
					if (this.isExtensionEnvironment()) {
						if (chrome.runtime && chrome.runtime.sendMessage) {
							chrome.runtime.sendMessage(
								{
									type: 'CONNECTION_TEST',
									data: { message: 'Content script connection check' },
								},
								(response) => {
									if (chrome.runtime.lastError) {
										console.warn('Connection check failed, retrying...', chrome.runtime.lastError);
										setTimeout(checkConnection, 1000);
									} else {
										console.log('Connection verified:', response);
										this.isConnected = true;
										this.reconnectAttempts = 0;
										resolve();
									}
								}
							);
						} else {
							console.warn('chrome.runtime.sendMessage not available, retrying...');
							setTimeout(checkConnection, 1000);
						}
					} else {
						console.warn('Extension environment not valid, retrying...');
						setTimeout(checkConnection, 1000);
					}
				};

				checkConnection();
			});
		},

		startConnectionCheck: function () {
			const periodicCheck = () => {
				console.log('Running periodic check...');
				try {
					if (this.isExtensionEnvironment()) {
						console.log('Extension environment valid, verifying connection...');
						this.verifyConnection()
							.then(() => {
								console.log('Periodic connection check successful');
							})
							.catch((error) => {
								console.error('Periodic connection check failed:', error);
								this.handleExtensionInvalidated();
							});
					} else {
						console.warn('Extension environment not valid, retrying periodic check...');
						this.handleExtensionInvalidated();
					}
				} catch (error) {
					console.error('Error during periodic check:', error);
					this.handleExtensionInvalidated();
				} finally {
					console.log('Scheduling next check...');
					setTimeout(periodicCheck, 5000);
				}
			};

			periodicCheck();
		},
	};

	// At the top of the IIFE, after the htmxDebugger object definition
	const htmxEvents = [
		'htmx:afterRequest',
		'htmx:afterSwap',
		'htmx:beforeRequest',
		'htmx:beforeSend',
		'htmx:beforeSwap',
		'htmx:configRequest',
		'htmx:historyCacheError',
		'htmx:load',
		'htmx:responseError',
		'htmx:xhr:loadend',
		'htmx:xhr:loadstart',
		'htmx:xhr:progress',
		'htmx:onLoadError',
		'htmx:targetError',
		'htmx:timeout',
	];

	function initializeDebugger() {
		try {
			if (htmxDebugger.isExtensionEnvironment()) {
				htmxDebugger.init();
				console.log('htmx-debugger initialized');
			} else {
				console.warn('Not running in a Chrome extension environment. Retrying in 1 second...');
				setTimeout(initializeDebugger, 1000);
			}
		} catch (error) {
			console.error('Error initializing htmx-debugger:', error);
			htmxDebugger.handleError(error);
		}
	}

	// Wait for the DOM to be fully loaded before initializing
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeDebugger);
	} else {
		initializeDebugger();
	}

	// Move the captureHtmxEvent and related functions inside the IIFE
	function captureHtmxEvent(event) {
		console.log('htmx event captured:', event.type, event);

		// Skip connection tests and other non-essential events
		if (event.type === 'TEST' || event.type === 'CONNECTION_TEST' || event.detail?.type === 'CONNECTION_TEST') {
			return;
		}

		let headers = {
			request: {},
			response: {},
		};

		let eventDetails = {
			type: event.type,
			detail: {},
			headers: headers,
		};

		if (event.detail) {
			switch (event.type) {
				case 'htmx:afterOnLoad':
				case 'htmx:afterRequest':
				case 'htmx:afterSettle':
				case 'htmx:afterSwap':
				case 'htmx:beforeOnLoad':
				case 'htmx:beforeRequest':
				case 'htmx:beforeSwap':
				case 'htmx:beforeSend':
				case 'htmx:configRequest':
				case 'htmx:historyCacheError':
				case 'htmx:beforeHistoryUpdate':
				case 'htmx:onLoadError':
				case 'htmx:responseError':
				case 'htmx:sendError':
				case 'htmx:swapError':
				case 'htmx:timeout':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
						xhr: event.detail.xhr ? getXhrInfo(event.detail.xhr) : null,
						target: getElementInfo(event.detail.target),
						requestConfig: event.detail.requestConfig,
					};
					break;
				case 'htmx:afterProcessNode':
				case 'htmx:beforeProcessNode':
				case 'htmx:load':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
					};
					break;
				case 'htmx:beforeCleanupElement':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
					};
					break;
				case 'htmx:confirm':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
						target: getElementInfo(event.detail.target),
						triggeringEvent: event.detail.triggeringEvent,
						question: event.detail.question,
					};
					break;
				case 'htmx:historyCacheMiss':
				case 'htmx:historyCacheMissError':
				case 'htmx:historyCacheMissLoad':
					eventDetails.detail = {
						xhr: event.detail.xhr ? getXhrInfo(event.detail.xhr) : null,
						path: event.detail.path,
					};
					break;
				case 'htmx:historyRestore':
				case 'htmx:beforeHistorySave':
				case 'htmx:pushedIntoHistory':
				case 'htmx:replacedInHistory':
					eventDetails.detail = {
						path: event.detail.path,
					};
					break;
				case 'htmx:sseError':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
						error: event.detail.error,
						source: event.detail.source,
					};
					break;
				case 'htmx:targetError':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
						target: event.detail.target,
					};
					break;
				case 'htmx:validation:validate':
				case 'htmx:validation:failed':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
						message: event.detail.message,
						validity: event.detail.validity,
					};
					break;
				case 'htmx:validation:halted':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
						errors: event.detail.errors,
					};
					break;
				case 'htmx:xhr:abort':
				case 'htmx:xhr:loadstart':
				case 'htmx:xhr:loadend':
				case 'htmx:xhr:progress':
					eventDetails.detail = {
						elt: getElementInfo(event.detail.elt),
					};
					break;
				default:
					eventDetails.detail = event.detail;
					break;
			}

			if (event.detail.xhr) {
				if (event.detail.xhr.requestHeaders) {
					headers.request = event.detail.xhr.requestHeaders;
				}
				if (event.detail.xhr.getAllResponseHeaders) {
					headers.response = parseHeaders(event.detail.xhr.getAllResponseHeaders());
				}
			}
		}

		if (chrome.runtime && chrome.runtime.sendMessage) {
			chrome.runtime.sendMessage(
				{
					type: 'HTMX_EVENT',
					data: eventDetails,
				},
				(response) => {
					if (chrome.runtime.lastError) {
						console.error('Error sending message:', chrome.runtime.lastError);
					} else {
						console.log('Message sent successfully:', response);
					}
				}
			);
		} else {
			console.warn('Not running in a Chrome extension environment. htmx event capture disabled.');
		}
	}

	function parseHeaders(headerStr) {
		var headers = {};
		if (!headerStr) {
			return headers;
		}
		var headerPairs = headerStr.split('\u000d\u000a');
		for (var i = 0; i < headerPairs.length; i++) {
			var headerPair = headerPairs[i];
			var index = headerPair.indexOf('\u003a\u0020');
			if (index > 0) {
				var key = headerPair.substring(0, index);
				var val = headerPair.substring(index + 2);
				headers[key] = val;
			}
		}
		return headers;
	}

	function getElementInfo(element) {
		if (!element) return null;
		try {
			const attributes = Array.from(element.attributes || []).map((attr) => ({
				name: attr.name,
				value: attr.value,
			}));

			const hxAttributes = attributes.filter((attr) => attr.name.startsWith('hx-'));

			return {
				id: element.id || '',
				tagName: element.tagName || '',
				className: element.className || '',
				attributes: attributes,
				hxAttributes: hxAttributes.length > 0 ? hxAttributes : undefined,
			};
		} catch (error) {
			console.error('Error getting element info:', error);
			return { error: 'Failed to get element info' };
		}
	}

	function getXhrInfo(xhr) {
		if (!xhr) return null;
		try {
			return {
				url: xhr.url || 'N/A',
				method: xhr.method || 'N/A',
				status: xhr.status || 'N/A',
				statusText: xhr.statusText || 'N/A',
			};
		} catch (error) {
			console.error('Error getting XHR info:', error);
			return { error: 'Failed to get XHR info' };
		}
	}

	// Set up event listeners only if running in a Chrome extension environment
	if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
		console.log('htmx-debugger content script loaded');

		// Listen for all htmx events
		htmxEvents.forEach((eventType) => {
			document.body.addEventListener(eventType, captureHtmxEvent, true);
		});

		console.log('htmx event listeners set up');
	} else {
		console.warn('Not running in a Chrome extension environment. htmx event capture disabled.');
	}
})();

console.log('htmx-debugger content script loaded');
