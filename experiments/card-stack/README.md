# Story card stack experiment

A standalone, fictional-data prototype for reviewing a possible mobile feed interaction. It does not connect to the application, database or recommendation service.

## Run locally

Open a terminal in this folder and run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

On Windows, use `python` instead of `python3` if needed. Open <http://127.0.0.1:8765/> on the same laptop. Use the browser's responsive mode for a phone-sized view. Stop the server with Ctrl+C. If port 8765 is in use, choose another port in the command and URL.

You can also open `index.html` directly in a modern browser. No package installation, account, database or credentials are needed. Photos are bundled; the optional Google Fonts request falls back to system fonts if unavailable.

## Try it

- Drag the top card right to save it, or left to pass.
- Tap or click the top card to read it; close the reading view to return to the stack.
- After the four fictional cards, choose **我的收藏** to see saved examples or **重新瀏覽** to start again.
- On desktop, drag with a mouse. With the card focused, Left/Right arrows pass/save and Enter opens it.

The stories are fictional and saved items are held only in page memory; reloading clears them. This is an interaction experiment, not production code or a finished recommendation flow.

The four bundled atmospheric photos are the same Pexels images used for fictional stories in the existing app design: [1](https://www.pexels.com/photo/40735592/), [2](https://www.pexels.com/photo/30322590/), [3](https://www.pexels.com/photo/33314069/), [4](https://www.pexels.com/photo/32039473/).
