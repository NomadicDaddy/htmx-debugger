import pluginJs from '@eslint/js';

export default [
	{
		languageOptions: {
			globals: {
				browser: true,
				es2021: true,
				worker: true,
				webextensions: true,
				chrome: 'readonly',
				console: 'readonly',
				document: 'readonly',
				htmx: 'readonly',
				window: 'readonly',
				setTimeout: 'readonly',
				setInterval: 'readonly',
				clearTimeout: 'readonly',
				clearInterval: 'readonly',
			},
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
			},
		},
		ignores: ['node_modules/*'],
		rules: {},
	},
	pluginJs.configs.recommended,
];
