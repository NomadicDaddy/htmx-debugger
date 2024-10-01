console.log('htmx-debugger DevTools script loaded');

chrome.devtools.panels.create('htmx', 'htmx-debugger-logo-16.png', 'panel.html', (panel) => {
	console.log('htmx panel created');
	panel.onShown.addListener(() => console.log('htmx panel shown'));
	panel.onHidden.addListener(() => console.log('htmx panel hidden'));
});
