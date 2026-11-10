import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var client = SseClient()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("This screen is the app. Statuses arrive on their own.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("State: \(client.link.rawValue) · last byte \(client.link == .open || client.link == .silent ? "\(client.silenceSeconds)s ago" : "—") · last_seq \(client.lastSeq.isEmpty ? "—" : client.lastSeq)")
                        .fontWeight(.semibold)
                    Text(client.baseURL)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    actionRow
                    Text(client.logText.isEmpty ? "Log is empty." : client.logText)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .padding()
            }
            .navigationTitle("SSE Simulation")
            .onChange(of: scenePhase) { _, phase in
                client.logScene(String(describing: phase))
            }
        }
    }

    private var actionRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button("Connect", action: client.connect)
                Button("Disconnect", action: client.disconnect)
            }
            HStack {
                Button("Copy log") {
                    UIPasteboard.general.string = client.logText
                }
                Button("Clear log") { client.clearLog() }
            }
        }
        .buttonStyle(.bordered)
    }
}
