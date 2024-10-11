$v = (Get-Content -Path './package.json' -Raw | ConvertFrom-Json)
"# building current version: $($v.version)"

'# development npm packages'
npm install -D eslint globals @eslint/js tailwindcss prettier prettier-plugin-tailwindcss

'# update packages'
npm update

'# build steps'
npm run lint
npm run css
npm run format

'# delete previous distribution files'
Remove-Item -Path './dist/*' -Force

'# copy distribution files'
Copy-Item -Path '.\background.js' -Destination './dist/background.js' -Force -Verbose
Copy-Item -Path '.\content.js' -Destination './dist/content.js' -Force -Verbose
Copy-Item -Path '.\devtools.html' -Destination './dist/devtools.html' -Force -Verbose
Copy-Item -Path '.\devtools.js' -Destination './dist/devtools.js' -Force -Verbose
Copy-Item -Path '.\htmx-debugger-logo-128.png' -Destination './dist/htmx-debugger-logo-128.png' -Force -Verbose
Copy-Item -Path '.\htmx-debugger-logo-16.png' -Destination './dist/htmx-debugger-logo-16.png' -Force -Verbose
Copy-Item -Path '.\htmx-debugger-logo-32.png' -Destination './dist/htmx-debugger-logo-32.png' -Force -Verbose
Copy-Item -Path '.\htmx-debugger-logo-48.png' -Destination './dist/htmx-debugger-logo-48.png' -Force -Verbose
Copy-Item -Path '.\output.css' -Destination './dist/output.css' -Force -Verbose
Copy-Item -Path '.\panel.html' -Destination './dist/panel.html' -Force -Verbose
Copy-Item -Path '.\panel.js' -Destination './dist/panel.js' -Force -Verbose
Copy-Item -Path '.\readme.md' -Destination './dist/readme.md' -Force -Verbose
Copy-Item -Path '.\manifest.json' -Destination './dist/manifest.json' -Force -Verbose

'# build firefox dist'
Copy-Item -Path '.\manifest-firefox.json' -Destination './dist/manifest.json' -Force -Verbose

'# create versioned distribution archive'
$zipFileName = "htmx-debugger-firefox-$($v.version).zip"
$zipFilePath = "./dist/$zipFileName"

'# create zip of all files in ./dist/'
Compress-Archive -Path './dist/*' -DestinationPath $zipFilePath -Force
"  created zip file: $zipFilePath"

"# move $($zipFilePath) to ./releases"
Get-ChildItem -Path './dist/*.zip' | Move-Item -Destination './releases/'

'# build chrome dist'
Copy-Item -Path '.\manifest.json' -Destination './dist/manifest.json' -Force -Verbose

'# create versioned distribution archive'
$zipFileName = "htmx-debugger-chrome-$($v.version).zip"
$zipFilePath = "./dist/$zipFileName"

'# create zip of all files in ./dist/'
Compress-Archive -Path './dist/*' -DestinationPath $zipFilePath -Force
"  created zip file: $zipFilePath"

"# move $($zipFilePath) to ./releases"
Get-ChildItem -Path './dist/*.zip' | Move-Item -Destination './releases/'
