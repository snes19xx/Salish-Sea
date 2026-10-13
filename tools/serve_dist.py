"""Serve the built web app, for testing it on another machine (such as the Linux laptop, which
gets the project through Syncthing). Python 3, standard library only, so it runs without geo_env.

    python3 tools/serve_dist.py web/dist      # from the project root, after `npm run build` in web/

With no folder given it serves the folder it sits in (for a copy placed inside a zipped dist).
Opens http://127.0.0.1:8000/?gui in the default browser.
"""
import http.server
import os
import sys
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


root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
if not os.path.isfile(os.path.join(root, 'index.html')):
    sys.exit(f'No index.html in {root}: run `npm run build` in web/ and pass web/dist.')
os.chdir(root)
server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
url = f'http://127.0.0.1:{PORT}/?gui'
print(f'Serving {root} at {url} (Ctrl+C to stop)')
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
