#!/usr/bin/env python3
"""
Orbbec depth camera → relay sender.

Captures colour + depth from an Orbbec camera using pyorbbecsdk,
encodes them in the relay wire format, and pushes them to the
local relay server on /source.

Install deps:
  pip install pyorbbecsdk websocket-client opencv-python

Wire format (matches relay.js / depth-receiver.ts):
  [0]      uint8    type  0=colour JPEG  1=depth Float32LE metres
  [1..4]   uint32LE width
  [5..8]   uint32LE height
  [9..12]  uint32LE timestamp ms
  [13..]   payload
"""

import struct
import time
import threading
import io
import argparse

import numpy as np
import cv2
from pyorbbecsdk import (
    Pipeline, Config,
    OBSensorType, OBFormat, OBAlignMode,
)
import websocket  # websocket-client


def encode_frame(frame_type: int, w: int, h: int, payload: bytes) -> bytes:
    ts = int(time.monotonic() * 1000) & 0xFFFFFFFF
    header = struct.pack('<BIIIII', frame_type, w, h, ts)[:13]  # pack first 13 bytes
    # Rebuild properly
    header = struct.pack('<B', frame_type) + struct.pack('<III', w, h, ts)
    return header + payload


def run(relay_url: str, jpeg_quality: int, target_fps: int):
    # Connect WebSocket
    ws = websocket.WebSocket()
    print(f"Connecting to relay at {relay_url} …")
    ws.connect(relay_url)
    print("Connected.")

    # Init Orbbec pipeline
    pipeline = Pipeline()
    config = Config()

    # Enable colour stream
    color_profiles = pipeline.get_stream_profile_list(OBSensorType.COLOR)
    color_profile = color_profiles.get_video_stream_profile(640, 480, OBFormat.RGB, target_fps)
    config.enable_stream(color_profile)

    # Enable depth stream
    depth_profiles = pipeline.get_stream_profile_list(OBSensorType.DEPTH)
    depth_profile = depth_profiles.get_video_stream_profile(640, 480, OBFormat.DEPTH, target_fps)
    config.enable_stream(depth_profile)

    # Align depth to colour
    config.set_align_mode(OBAlignMode.HW_MODE)

    pipeline.start(config)
    print(f"Pipeline running at up to {target_fps} fps …  Press Ctrl+C to stop.")

    frame_interval = 1.0 / target_fps
    last_send = 0.0

    try:
        while True:
            frames = pipeline.wait_for_frames(100)
            if frames is None:
                continue

            now = time.monotonic()
            if now - last_send < frame_interval * 0.9:
                continue
            last_send = now

            color_frame = frames.get_color_frame()
            depth_frame = frames.get_depth_frame()
            if color_frame is None or depth_frame is None:
                continue

            # --- Colour → JPEG bytes ---
            cw = color_frame.get_width()
            ch = color_frame.get_height()
            color_data = np.frombuffer(color_frame.get_data(), dtype=np.uint8).reshape((ch, cw, 3))
            bgr = cv2.cvtColor(color_data, cv2.COLOR_RGB2BGR)
            ok, jpeg_buf = cv2.imencode('.jpg', bgr, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
            if not ok:
                continue
            color_payload = jpeg_buf.tobytes()

            # --- Depth → Float32 metres ---
            dw = depth_frame.get_width()
            dh = depth_frame.get_height()
            scale = depth_frame.get_depth_scale()  # typically 0.001 (mm → m)
            depth_raw = np.frombuffer(depth_frame.get_data(), dtype=np.uint16).reshape((dh, dw))
            depth_m = depth_raw.astype(np.float32) * scale  # 0 = no data
            depth_payload = depth_m.tobytes()

            # Send colour then depth
            ws.send_binary(encode_frame(0, cw, ch, color_payload))
            ws.send_binary(encode_frame(1, dw, dh, depth_payload))

    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        pipeline.stop()
        ws.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Orbbec → relay sender')
    parser.add_argument('--relay', default='ws://localhost:8080/source', help='Relay WebSocket URL')
    parser.add_argument('--quality', type=int, default=75, help='JPEG quality 1-100')
    parser.add_argument('--fps', type=int, default=30, help='Target frame rate')
    args = parser.parse_args()

    run(args.relay, args.quality, args.fps)
