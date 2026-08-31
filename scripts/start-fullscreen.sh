#!/usr/bin/env bash
# Builds and serves the production bundle, then opens it fullscreen in
# Chromium with camera permission auto-granted (no click needed — there's
# no mouse in kiosk mode).
#
# Uses a production build + `vite preview` rather than `vite dev`: the dev
# server's transform middleware refuses to serve public/ort/*.mjs when it's
# loaded via dynamic import() (as onnxruntime-web's WebGPU/JSEP backend does),
# which broke the segmenter under `vite dev`.
set -euo pipefail

cd "$(dirname "$0")/.."

# Autostart (Hyprland exec-once) runs without a login shell, so mise's
# shims (node/npm/chromium) won't be on PATH unless added explicitly.
export PATH="$HOME/.local/share/mise/shims:$PATH"

PORT=4173
URL="http://localhost:${PORT}"
PROFILE_DIR="$HOME/.cache/webcam-mirror-kiosk-profile"
CHROMIUM="$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || command -v google-chrome)"

if [[ -z "$CHROMIUM" ]]; then
  echo "No Chromium/Chrome binary found on PATH" >&2
  exit 1
fi

npm run build
npm run preview -- --port "$PORT" --strictPort &
VITE_PID=$!

cleanup() {
  kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for the dev server to come up before launching the browser.
for _ in $(seq 1 50); do
  curl -sf "$URL" -o /dev/null && break
  sleep 0.2
done

"$CHROMIUM" \
  --kiosk \
  --user-data-dir="$PROFILE_DIR" \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --overscroll-history-navigation=0 \
  "$URL"
