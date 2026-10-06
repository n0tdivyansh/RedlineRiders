'''Local dev server for the game: like `python -m http.server`, but tells the browser never to cache,
so edited JS (and a re-exported js/bike-models.js) shows up on a plain reload.
Usage: python dev/serve.py [port]   (serves the folder above dev/, default port 5178)'''
import http.server, os, sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
print('Redline Riders on http://localhost:%d' % port)
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
