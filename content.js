(function () {
	/* global Element, XMLHttpRequest, Event */

	// Unshadowable accessors for element properties, captured before any page script runs.
	const elementAccessor = (name) => {
		const descriptor = typeof Element !== 'undefined' && Object.getOwnPropertyDescriptor(Element.prototype, name);
		return descriptor && descriptor.get
			? descriptor.get
			: function () {
					return this[name];
				};
	};
	const elementAttributes = elementAccessor('attributes');
	const elementTagName = elementAccessor('tagName');

	const htmxDebugger = {
		isConnected: false,
		isContextInvalidated: false,
		hasLoggedCloneFailure: false,
		hasWarnedDisconnected: false,
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
			if (this.isContextInvalidated) return;

			try {
				if (!this.isExtensionEnvironment()) {
					this.handleExtensionInvalidated();
					return;
				}

				this.setupMessageListener();
				const connected = await this.verifyConnection();
				if (!connected || this.isContextInvalidated) return;
				this.startConnectionCheck();

				if (!this.isExtensionValid()) {
					this.handleExtensionInvalidated();
					return;
				}
				htmxEvents.forEach((event) => {
					document.body.addEventListener(event, this.logEvent.bind(this));
				});

				// console.log('htmx event listeners set up');
			} catch (error) {
				if (this.isContextInvalidationError(error)) {
					this.handleExtensionInvalidated();
					return;
				}
				console.error('Error during htmx-debugger initialization:', error);
				this.handleError(error);
				if (!this.isContextInvalidated) {
					setTimeout(() => this.init(), 5000);
				}
			}
		},

		isExtensionEnvironment: function () {
			if (this.isContextInvalidated || typeof chrome === 'undefined') return false;

			try {
				return Boolean(chrome.runtime && chrome.runtime.id);
			} catch {
				return false;
			}
		},

		isExtensionValid: function () {
			return !this.isContextInvalidated && this.isExtensionEnvironment();
		},

		getElementInfo: function (element) {
			if (!element) return null;
			try {
				if (typeof Element === 'undefined' || !(element instanceof Element)) {
					// document, window, and other non-element event targets
					return { id: '', tagName: '', className: '', attributes: [] };
				}

				// Read through Element.prototype rather than off the element. A form whose
				// controls are named `id`, `attributes`, or `getAttribute` shadows those
				// properties with the control itself, which then leaks a DOM node into the
				// message and makes chrome.runtime.sendMessage fail to clone it.
				const attributes = Array.from(elementAttributes.call(element)).map((attr) => ({
					name: attr.name,
					value: attr.value,
				}));

				const hxAttributes = attributes.filter((attr) => attr.name.startsWith('hx-'));
				const attributeValue = (name) => {
					const attr = attributes.find((candidate) => candidate.name === name);
					return attr ? attr.value : '';
				};

				return {
					id: attributeValue('id'),
					tagName: elementTagName.call(element),
					// SVG elements expose className as a non-cloneable SVGAnimatedString
					className: attributeValue('class'),
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

		parseHeaders: function (headerStr) {
			const headers = {};
			if (!headerStr) {
				return headers;
			}
			headerStr.split('\r\n').forEach((headerPair) => {
				const index = headerPair.indexOf(': ');
				if (index > 0) {
					headers[headerPair.substring(0, index)] = headerPair.substring(index + 2);
				}
			});
			return headers;
		},

		logEvent: function (event) {
			if (this.isContextInvalidated) return;

			if (this.isCircuitBroken) {
				return;
			}

			if (this.eventCounter >= this.maxEvents) {
				const now = Date.now();
				if (now - this.lastResetTime < 60000) {
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
					detail: this.sanitizeDetail(event.detail),
				};

				// console.log('htmx Event captured:', eventInfo);
				// console.log('HX Attributes:', eventInfo.target.hxAttributes);

				if (event.type.startsWith('htmx:xhr:') && event.detail && event.detail.xhr) {
					eventInfo.xhr = this.getXhrInfo(event.detail.xhr);
				}

				if (event.detail && event.detail.xhr && typeof event.detail.xhr.getAllResponseHeaders === 'function') {
					const rawHeaders = event.detail.xhr.getAllResponseHeaders();
					if (rawHeaders) {
						eventInfo.responseHeaders = this.parseHeaders(rawHeaders);
					}
				}

				// console.log('htmx Event:', eventInfo);
				this.sendMessage(eventInfo);
			} catch (error) {
				console.error('Error logging event:', error);
				this.handleError(error);
			}
		},

		sanitizeDetail: function (input, seen = new WeakSet()) {
			if (input === null || input === undefined) {
				return null;
			}

			const inputType = typeof input;
			if (inputType === 'string' || inputType === 'number' || inputType === 'boolean') {
				return input;
			}
			if (input instanceof Date) {
				return input.toISOString();
			}
			if (inputType === 'bigint') {
				return input.toString();
			}
			if (inputType === 'symbol') {
				return input.toString();
			}

			if (inputType === 'function') {
				return undefined;
			}

			if (typeof Element !== 'undefined' && input instanceof Element) {
				return this.getElementInfo(input);
			}

			if (typeof XMLHttpRequest !== 'undefined' && input instanceof XMLHttpRequest) {
				return this.getXhrInfo(input);
			}

			if (typeof Event !== 'undefined' && input instanceof Event) {
				return {
					type: input.type,
					timestamp: input.timeStamp,
					target: this.getElementInfo(input.target),
				};
			}

			if (input && input.constructor && input.constructor.name === 'ValidityState') {
				const validityProps = [
					'badInput',
					'customError',
					'patternMismatch',
					'rangeOverflow',
					'rangeUnderflow',
					'stepMismatch',
					'tooLong',
					'tooShort',
					'typeMismatch',
					'valid',
					'valueMissing',
				];
				return validityProps.reduce((acc, prop) => {
					if (prop in input) {
						acc[prop] = input[prop];
					}
					return acc;
				}, {});
			}

			// Only containers are tracked for cycles, and only while they are on the current
			// path — otherwise two sibling references to the same element (htmx routinely
			// puts the same node on `elt` and `target`) report the second one as circular.
			if (Array.isArray(input)) {
				if (seen.has(input)) {
					return '[Circular]';
				}
				seen.add(input);
				try {
					return input.map((item) => this.sanitizeDetail(item, seen)).filter((item) => item !== undefined);
				} finally {
					seen.delete(input);
				}
			}

			const proto = Object.getPrototypeOf(input);
			if (proto === Object.prototype || proto === null) {
				if (seen.has(input)) {
					return '[Circular]';
				}
				seen.add(input);
				try {
					const output = {};
					Object.keys(input).forEach((key) => {
						const value = this.sanitizeDetail(input[key], seen);
						if (value !== undefined) {
							output[key] = value;
						}
					});
					return output;
				} finally {
					seen.delete(input);
				}
			}

			return input.toString ? input.toString() : Object.prototype.toString.call(input);
		},

		sendMessage: function (data) {
			if (this.isContextInvalidated) return;

			if (!this.isConnected) {
				// sendMessage runs once per htmx event, so this warns only on the first
				// dropped event after a disconnect rather than on every one.
				if (!this.hasWarnedDisconnected) {
					this.hasWarnedDisconnected = true;
					console.warn('htmx-debugger: not connected to the background script. Attempting to reconnect...');
				}
				this.verifyConnection();
				return;
			}

			try {
				// console.log('Sending htmx debug info:', JSON.stringify(data, null, 2));
				chrome.runtime.sendMessage(
					{
						type: 'HTMX_EVENT',
						data: data,
					},
					() => {
						let runtimeError;
						try {
							runtimeError = chrome.runtime.lastError;
						} catch (error) {
							this.handleError(error);
							return;
						}

						if (!runtimeError) {
							// console.log('Message sent successfully:', response);
							this.reconnectAttempts = 0; // Reset reconnect attempts on successful message
							return;
						}

						if (this.isContextInvalidationError(runtimeError)) {
							this.handleExtensionInvalidated();
							return;
						}

						if (this.isCloneError(runtimeError)) {
							this.reportCloneFailure(runtimeError);
							return;
						}

						console.error('Error sending message:', runtimeError);
						this.handleError(new Error(runtimeError.message));
						this.isConnected = false;
						this.attemptReconnection();
					}
				);
			} catch (error) {
				if (this.isContextInvalidationError(error)) {
					this.handleExtensionInvalidated();
					return;
				}

				if (this.isCloneError(error)) {
					this.reportCloneFailure(error);
					return;
				}

				console.error('Error sending message:', error);
				this.handleError(error);
				this.isConnected = false;
				this.attemptReconnection();
			}
		},

		setupMessageListener: function () {
			if (chrome.runtime && chrome.runtime.onMessage) {
				chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

		isContextInvalidationError: function (error) {
			const message = typeof error === 'string' ? error : error && error.message;
			return Boolean(message && message.includes('Extension context invalidated'));
		},

		isCloneError: function (error) {
			if (error && error.name === 'DataCloneError') return true;
			const message = typeof error === 'string' ? error : error && error.message;
			return Boolean(message && /could not be cloned|could not (?:be )?serialized?/i.test(message));
		},

		reportCloneFailure: function (error) {
			// A payload that fails structured cloning will fail again on retry, so the event is
			// dropped rather than fed to handleError, which would trip the circuit breaker and
			// flood the console on a page that emits the offending event repeatedly.
			if (this.hasLoggedCloneFailure) return;

			this.hasLoggedCloneFailure = true;
			console.warn('htmx-debugger: dropped an event that could not be serialized. Further occurrences are suppressed.', error);
		},

		handleError: function (error) {
			if (this.isContextInvalidationError(error)) {
				this.handleExtensionInvalidated();
				return;
			}

			console.error('htmx-debugger error:', error);
			this.errorCount++;

			if (this.errorCount >= this.maxErrors) {
				this.triggerCircuitBreaker();
			}

			this.sendMessage({
				type: 'ERROR',
				error: error.message,
				stack: error.stack,
			});
		},

		handleExtensionInvalidated: function () {
			if (this.isContextInvalidated) return;

			this.isContextInvalidated = true;
			this.isConnected = false;
		},

		attemptReconnection: function () {
			if (this.isContextInvalidated) return;

			if (this.reconnectAttempts < this.maxReconnectAttempts) {
				this.reconnectAttempts++;
				console.log(`Reconnection attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts}`);
				setTimeout(() => {
					if (!this.isContextInvalidated) {
						this.verifyConnection();
					}
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
					if (this.isContextInvalidated) return;

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
					if (this.isContextInvalidated) {
						resolve(false);
						return;
					}

					if (!this.isExtensionEnvironment()) {
						this.handleExtensionInvalidated();
						resolve(false);
						return;
					}

					try {
						if (chrome.runtime.sendMessage) {
							chrome.runtime.sendMessage(
								{
									type: 'CONNECTION_TEST',
									data: { message: 'Content script connection check' },
								},
								() => {
									const runtimeError = chrome.runtime.lastError;
									if (runtimeError && this.isContextInvalidationError(runtimeError)) {
										this.handleExtensionInvalidated();
										resolve(false);
									} else if (runtimeError) {
										console.warn('Connection check failed, retrying...', runtimeError);
										setTimeout(checkConnection, 1000);
									} else {
										this.isConnected = true;
										this.reconnectAttempts = 0;
										this.hasWarnedDisconnected = false;
										resolve(true);
									}
								}
							);
						} else {
							console.warn('chrome.runtime.sendMessage not available, retrying...');
							setTimeout(checkConnection, 1000);
						}
					} catch (error) {
						if (this.isContextInvalidationError(error)) {
							this.handleExtensionInvalidated();
							resolve(false);
						} else {
							console.warn('Connection check failed, retrying...', error);
							setTimeout(checkConnection, 1000);
						}
					}
				};

				checkConnection();
			});
		},

		startConnectionCheck: function () {
			const periodicCheck = () => {
				if (this.isContextInvalidated) return;

				// console.log('Running periodic check...');
				try {
					if (this.isExtensionEnvironment()) {
						// console.log('Extension environment valid, verifying connection...');
						this.verifyConnection()
							.then(() => {
								// console.log('Periodic connection check successful');
							})
							.catch((error) => {
								console.error('Periodic connection check failed:', error);
								this.handleExtensionInvalidated();
							});
					} else {
						this.handleExtensionInvalidated();
					}
				} catch (error) {
					if (this.isContextInvalidationError(error)) {
						this.handleExtensionInvalidated();
					} else {
						console.error('Error during periodic check:', error);
					}
				} finally {
					if (!this.isContextInvalidated) {
						setTimeout(periodicCheck, 5000);
					}
				}
			};

			periodicCheck();
		},
	};

	// At the top of the IIFE, after the htmxDebugger object definition
	const htmxEvents = [
		'htmx:abort',
		'htmx:after:cleanup',
		'htmx:after:history:push',
		'htmx:after:history:replace',
		'htmx:after:history:update',
		'htmx:after:implicitInheritance',
		'htmx:after:init',
		'htmx:after:process',
		'htmx:after:request',
		'htmx:after:settle',
		'htmx:after:swap',
		'htmx:after:viewTransition',
		'htmx:afterOnLoad',
		'htmx:afterProcessNode',
		'htmx:afterRequest',
		'htmx:afterSettle',
		'htmx:afterSwap',
		'htmx:before:cleanup',
		'htmx:before:history:restore',
		'htmx:before:history:update',
		'htmx:before:init',
		'htmx:before:morph:attr',
		'htmx:before:morph:node',
		'htmx:before:on:init',
		'htmx:before:process',
		'htmx:before:request',
		'htmx:before:response',
		'htmx:before:settle',
		'htmx:before:swap',
		'htmx:before:viewTransition',
		'htmx:beforeCleanupElement',
		'htmx:beforeHistorySave',
		'htmx:beforeHistoryUpdate',
		'htmx:beforeOnLoad',
		'htmx:beforeProcessNode',
		'htmx:beforeRequest',
		'htmx:beforeSend',
		'htmx:beforeSwap',
		'htmx:beforeTransition',
		'htmx:config:request',
		'htmx:configRequest',
		'htmx:confirm',
		'htmx:error',
		'htmx:finally:request',
		'htmx:historyCacheError',
		'htmx:historyCacheHit',
		'htmx:historyCacheMiss',
		'htmx:historyCacheMissError',
		'htmx:historyCacheMissLoad',
		'htmx:historyCacheMissLoadError',
		'htmx:historyRestore',
		'htmx:load',
		'htmx:noSSESourceError',
		'htmx:oobAfterSwap',
		'htmx:oobBeforeSwap',
		'htmx:oobErrorNoTarget',
		'htmx:onLoadError',
		'htmx:prompt',
		'htmx:pushedIntoHistory',
		'htmx:replacedInHistory',
		'htmx:response:error',
		'htmx:responseError',
		'htmx:sendAbort',
		'htmx:sendError',
		'htmx:scope',
		'htmx:sseError',
		'htmx:swap:finally',
		'htmx:swapError',
		'htmx:targetError',
		'htmx:timeout',
		'htmx:trigger',
		'htmx:validateUrl',
		'htmx:validation:failed',
		'htmx:validation:halted',
		'htmx:validation:validate',
		'htmx:xhr:abort',
		'htmx:xhr:loadend',
		'htmx:xhr:loadstart',
		'htmx:xhr:progress',
	];

	function initializeDebugger() {
		try {
			if (htmxDebugger.isExtensionEnvironment()) {
				htmxDebugger.init();
			} else {
				htmxDebugger.handleExtensionInvalidated();
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
})();
