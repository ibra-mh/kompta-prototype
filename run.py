"""
Double-click-friendly launcher for the Kompta tax engine backend.

Run this with:   python run.py
It starts the server at http://127.0.0.1:8000 and keeps running until
you close the window / press Ctrl+C. Leave it open while you use
the app at that address.
"""
import os
import socket
import sys

if sys.version_info < (3, 10):
    sys.exit("Kompta requires Python 3.10 or newer (found " + sys.version.split()[0] + ").")

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("KOMPTA_HOST", "127.0.0.1")
    port = int(os.environ.get("KOMPTA_PORT", "8000"))
    # A leftover older server on this port would keep answering with 404s.
    with socket.socket() as probe:
        if probe.connect_ex((host, port)) == 0:
            sys.exit(f"Port {port} is already in use (an old Kompta server?). Close it or set KOMPTA_PORT.")
    os.environ.setdefault("KOMPTA_DEV_CORS_ORIGINS", "http://127.0.0.1:5500")
    print("=" * 60)
    print(f"Kompta starting: open http://{host}:{port}/ in your browser")
    print("Development CORS origin: " + os.environ["KOMPTA_DEV_CORS_ORIGINS"])
    print("Press Ctrl+C to stop the server.")
    print("=" * 60)
    uvicorn.run("main:app", host=host, port=port, reload=False)
