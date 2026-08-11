import SwiftUI

struct ContentView: View {
    @StateObject private var streamer = DepthStreamer()
    @State private var serverIP = ""
    @State private var port = "8080"

    var wsURL: URL? {
        let str = "ws://\(serverIP):\(port)/source"
        return URL(string: str)
    }

    var body: some View {
        VStack(spacing: 24) {
            Text("Depth Streamer")
                .font(.largeTitle.bold())

            VStack(alignment: .leading, spacing: 8) {
                Text("Mac IP Address").font(.caption).foregroundColor(.secondary)
                HStack {
                    TextField("192.168.x.x", text: $serverIP)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numbersAndPunctuation)
                        .autocorrectionDisabled()
                    TextField("8080", text: $port)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                        .frame(width: 72)
                }
            }
            .padding(.horizontal)

            HStack(spacing: 16) {
                Circle()
                    .fill(streamer.isConnected ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                Text(streamer.statusMessage)
                    .foregroundColor(.secondary)
            }

            if streamer.isRunning {
                Text(String(format: "%.1f fps", streamer.fps))
                    .font(.system(.title2, design: .monospaced))
            }

            Button {
                if streamer.isRunning {
                    streamer.stop()
                } else {
                    guard let url = wsURL, !serverIP.isEmpty else { return }
                    streamer.connect(to: url)
                    streamer.start()
                }
            } label: {
                Text(streamer.isRunning ? "Stop" : "Start Streaming")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(streamer.isRunning ? Color.red : Color.blue)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .padding(.horizontal)
            .disabled(serverIP.isEmpty && !streamer.isRunning)
        }
        .padding(.vertical, 40)
    }
}
