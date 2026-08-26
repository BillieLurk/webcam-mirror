import AVFoundation
import Foundation
import VideoToolbox

// MARK: - Frame type constants (must match relay.js)
private let kFrameColor: UInt8 = 0
private let kFrameDepth: UInt8 = 1

// MARK: - DepthStreamer

/// Captures synced color + depth frames from the rear camera and streams them
/// to the relay server over a WebSocket connection.
///
/// Usage:
///   let streamer = DepthStreamer()
///   streamer.connect(to: URL(string: "ws://192.168.1.x:8080/source")!)
///   streamer.start()
///   ...
///   streamer.stop()
final class DepthStreamer: NSObject, ObservableObject {

    // MARK: Published state
    @Published var isRunning = false
    @Published var isConnected = false
    @Published var statusMessage = "Idle"
    @Published var fps: Double = 0

    // MARK: Private
    private var session: AVCaptureSession?
    private var synchronizer: AVCaptureDataOutputSynchronizer?
    private var videoOutput = AVCaptureVideoDataOutput()
    private var depthOutput = AVCaptureDepthDataOutput()
    private var sessionQueue = DispatchQueue(label: "depth.session", qos: .userInteractive)

    private var webSocketTask: URLSessionWebSocketTask?
    private var wsURL: URL?

    // FPS tracking
    private var frameCount = 0
    private var fpsTimer: Timer?
    private var lastFpsTime = Date()

    // MARK: - Public API

    func connect(to url: URL) {
        wsURL = url
        reconnect()
    }

    func start() {
        sessionQueue.async { [weak self] in
            self?.setupAndStart()
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            self?.session?.stopRunning()
        }
        fpsTimer?.invalidate()
        DispatchQueue.main.async { [weak self] in
            self?.isRunning = false
            self?.statusMessage = "Stopped"
        }
    }

    // MARK: - WebSocket

    private func reconnect() {
        webSocketTask?.cancel()
        guard let url = wsURL else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        webSocketTask = task
        task.resume()
        DispatchQueue.main.async { [weak self] in
            self?.isConnected = true
            self?.statusMessage = "Connected"
        }
    }

    // MARK: - Capture setup

    private func setupAndStart() {
        let session = AVCaptureSession()
        session.sessionPreset = .vga640x480  // balance quality vs bandwidth

        // Pick the rear camera with LiDAR if available, else built-in wide
        let deviceTypes: [AVCaptureDevice.DeviceType] = [
            .builtInLiDARDepthCamera,
            .builtInTrueDepthCamera,
            .builtInDualWideCamera,
            .builtInWideAngleCamera
        ]
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: deviceTypes,
            mediaType: .video,
            position: .back
        )
        guard let camera = discovery.devices.first,
              let input = try? AVCaptureDeviceInput(device: camera) else {
            DispatchQueue.main.async { self.statusMessage = "No suitable camera found" }
            return
        }

        session.beginConfiguration()

        if session.canAddInput(input) { session.addInput(input) }

        // Video output — BGRA for easy JPEG encoding
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }

        // Depth output
        depthOutput.isFilteringEnabled = true  // temporal smoothing
        if session.canAddOutput(depthOutput) { session.addOutput(depthOutput) }

        session.commitConfiguration()

        // Synchronized capture — ensures color & depth are same-timestamp pairs
        let sync = AVCaptureDataOutputSynchronizer(
            dataOutputs: [videoOutput, depthOutput]
        )
        sync.setDelegate(self, queue: sessionQueue)
        synchronizer = sync
        self.session = session

        session.startRunning()

        DispatchQueue.main.async { [weak self] in
            self?.isRunning = true
            self?.statusMessage = "Streaming…"
        }

        // FPS counter
        DispatchQueue.main.async { [weak self] in
            self?.fpsTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                guard let self else { return }
                let now = Date()
                let elapsed = now.timeIntervalSince(self.lastFpsTime)
                self.fps = Double(self.frameCount) / elapsed
                self.frameCount = 0
                self.lastFpsTime = now
            }
        }
    }

    // MARK: - Frame encoding & sending

    private func sendColorFrame(_ pixelBuffer: CVPixelBuffer, timestamp: UInt32) {
        // Convert CVPixelBuffer → JPEG
        var cgImage: CGImage?
        VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &cgImage)
        guard let cg = cgImage else { return }
        let uiImage = UIImage(cgImage: cg, scale: 1.0, orientation: .right)
        guard let jpeg = uiImage.jpegData(compressionQuality: 0.65) else { return }

        let w = UInt32(CVPixelBufferGetWidth(pixelBuffer))
        let h = UInt32(CVPixelBufferGetHeight(pixelBuffer))
        let header = makeHeader(type: kFrameColor, width: w, height: h, timestamp: timestamp)
        var buf = header
        buf.append(jpeg)
        send(buf)
    }

    private func sendDepthFrame(_ depthData: AVDepthData, timestamp: UInt32) {
        // Convert to metric depth (metres, Float32)
        let converted = depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let pixelBuffer = converted.depthDataMap

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        let w = CVPixelBufferGetWidth(pixelBuffer)
        let h = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }

        var floatBytes = Data(count: w * h * 4)
        floatBytes.withUnsafeMutableBytes { dst in
            let src = base.assumingMemoryBound(to: UInt8.self)
            // Copy row by row to handle bytesPerRow padding
            for row in 0..<h {
                let srcRow = src + row * bytesPerRow
                let dstRow = dst.baseAddress!.advanced(by: row * w * 4)
                memcpy(dstRow, srcRow, w * 4)
            }
        }

        let header = makeHeader(type: kFrameDepth, width: UInt32(w), height: UInt32(h), timestamp: timestamp)
        var buf = header
        buf.append(floatBytes)
        send(buf)
    }

    private func makeHeader(type: UInt8, width: UInt32, height: UInt32, timestamp: UInt32) -> Data {
        var buf = Data(capacity: 13)
        buf.append(type)
        withUnsafeBytes(of: width.littleEndian) { buf.append(contentsOf: $0) }
        withUnsafeBytes(of: height.littleEndian) { buf.append(contentsOf: $0) }
        withUnsafeBytes(of: timestamp.littleEndian) { buf.append(contentsOf: $0) }
        return buf
    }

    private func send(_ data: Data) {
        guard let ws = webSocketTask else { return }
        ws.send(.data(data)) { [weak self] error in
            if let error {
                print("WebSocket send error: \(error)")
                DispatchQueue.main.async { self?.statusMessage = "Send error — reconnecting" }
                self?.reconnect()
            }
        }
    }
}

// MARK: - AVCaptureDataOutputSynchronizerDelegate

extension DepthStreamer: AVCaptureDataOutputSynchronizerDelegate {
    func dataOutputSynchronizer(
        _ synchronizer: AVCaptureDataOutputSynchronizer,
        didOutput collection: AVCaptureSynchronizedDataCollection
    ) {
        guard
            let syncedVideo = collection.synchronizedData(for: videoOutput)
                as? AVCaptureSynchronizedSampleBufferData,
            !syncedVideo.sampleBufferWasDropped,
            let syncedDepth = collection.synchronizedData(for: depthOutput)
                as? AVCaptureSynchronizedDepthData,
            !syncedDepth.depthDataWasDropped
        else { return }

        let ts = UInt32(syncedVideo.timestamp.seconds * 1000)

        if let pixelBuffer = CMSampleBufferGetImageBuffer(syncedVideo.sampleBuffer) {
            sendColorFrame(pixelBuffer, timestamp: ts)
        }
        sendDepthFrame(syncedDepth.depthData, timestamp: ts)

        frameCount += 1
    }
}
