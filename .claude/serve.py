"""Local dev server for public/: like `python -m http.server`, but tells the browser not to cache, so a reload always
gets the latest JavaScript (Chrome otherwise keeps old ES modules)."""
import functools
import http.server
import pathlib
import sys

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
http.server.ThreadingHTTPServer(("localhost", port), functools.partial(NoCache, directory=str(PUBLIC))).serve_forever()
