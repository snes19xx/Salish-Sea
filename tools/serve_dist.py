"""Serve the built web app from the folder this file sits in, for testing it on another machine.

Copied into the app zip as serve.py. Python 3, standard library only, so it runs
on a laptop without geo_env: double-click it, or run `python serve.py`. It opens
http://127.0.0.1:8000/?gui in the default browser.
"""
import http.server
import os
import webbrowser

PORT = 8000

# Set the types the app needs here: on Windows, Python takes them from the registry, which can
# map .js to text/plain, and browsers refuse to run module scripts served that way.
TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}


os.chdir(os.path.dirname(os.path.abspath(__file__)))
server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
url = f'http://127.0.0.1:{PORT}/?gui'
print(f'Serving {os.getcwd()} at {url} (close this window or press Ctrl+C to stop)')
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
