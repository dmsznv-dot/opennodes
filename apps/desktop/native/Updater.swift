import Foundation
import WebKit

// Bounded ephemeral transfers. Renderer content never supplies download URLs.
private final class UpdateTransfer: NSObject, URLSessionDataDelegate {
    private let maximum: Int64
    private let file: FileHandle?
    private let progress: ((Double) -> Void)?
    private let api: Bool
    private var bytes: Int64 = 0
    private var expected: Int64 = 0
    private var buffer = Data()
    private var failure: Error?
    private let finished = DispatchSemaphore(value: 0)
    private var redirects = 0
    init(maximum: Int64, file: FileHandle? = nil, api: Bool = false, progress: ((Double) -> Void)? = nil) {
        self.maximum = maximum; self.file = file; self.api = api; self.progress = progress
    }
    func fetch(_ url: URL) throws -> Data {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 45; configuration.timeoutIntervalForResource = 1200
        configuration.httpShouldSetCookies = false; configuration.httpCookieStorage = nil
        configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        var request = URLRequest(url: url)
        request.setValue("OpenNodes-macOS-Updater", forHTTPHeaderField: "User-Agent")
        request.setValue(api ? "application/vnd.github+json" : "application/octet-stream", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        session.dataTask(with: request).resume()
        finished.wait(); session.invalidateAndCancel()
        if let failure = failure { throw failure }
        return buffer
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects += 1
        guard !api, redirects <= 5, let url = request.url, url.scheme == "https", url.user == nil, url.password == nil, url.port == nil,
              ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].contains(url.host ?? "") else {
            failure = UpdateFailure("The update redirects outside GitHub's permitted download hosts."); completionHandler(nil); return
        }
        completionHandler(request)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, response.expectedContentLength <= maximum else {
            failure = UpdateFailure("GitHub cannot provide this update. Check your connection and try again."); completionHandler(.cancel); return
        }
        expected = response.expectedContentLength; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        bytes += Int64(data.count)
        guard bytes <= maximum else { failure = UpdateFailure("The update download exceeds its size limit."); dataTask.cancel(); return }
        do { if let file = file { try file.write(contentsOf: data) } else { buffer.append(data) } }
        catch { failure = error; dataTask.cancel() }
        if expected > 0 { progress?(min(1, Double(bytes) / Double(expected))) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if failure == nil { failure = error }; finished.signal()
    }
}

final class DesktopUpdater: NSObject, WKScriptMessageHandler {
    let currentVersion: String
    var onState: (([String: Any]) -> Void)?
    var onInstall: (() -> Void)?
    var acceptsMessage: ((WKScriptMessage) -> Bool)?
    private var release: VerifiedRelease?
    private var busy = false
    private(set) var state: [String: Any]
    private let worker = DispatchQueue(label: "app.opennodes.updater", qos: .utility)
    private let resultURL: URL
    private let dataDirectory: URL
    private var completedBackup: URL?
    private struct StagedUpdate { let directory: URL; let helper: URL; let plan: URL }
    private var stagedUpdate: StagedUpdate?
    init(dataURL: URL) {
        currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.3.0"
        dataDirectory = dataURL.standardizedFileURL
        resultURL = dataURL.appendingPathComponent("update-result.json")
        state = ["status": "idle", "currentVersion": currentVersion]
        super.init()
        if let data = try? Data(contentsOf: resultURL), let result = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            if let error = result["error"] { state = ["status": "error", "currentVersion": currentVersion, "error": error] }
            else if result["version"] == currentVersion, let backup = result["backup"],
                    URL(fileURLWithPath: backup).deletingLastPathComponent() == Bundle.main.bundleURL.deletingLastPathComponent(),
                    URL(fileURLWithPath: backup).lastPathComponent.hasPrefix(".OpenNodes-backup-") {
                completedBackup = URL(fileURLWithPath: backup)
            }
            if completedBackup == nil { try? FileManager.default.removeItem(at: resultURL) }
        }
    }
    func completeLaunch() {
        guard let backup = completedBackup else { return }
        try? FileManager.default.removeItem(at: backup)
        try? FileManager.default.removeItem(at: resultURL); completedBackup = nil
    }
    func publish() { onState?(state) }
    private func set(_ status: String, extra: [String: Any] = [:]) {
        var value: [String: Any] = ["status": status, "currentVersion": currentVersion]
        if let release = release { value["version"] = release.version; value["releaseNotes"] = release.notes }
        value.merge(extra, uniquingKeysWith: { _, new in new }); state = value; publish()
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard acceptsMessage?(message) == true, let body = message.body as? [String: Any], body.count == 1, let action = body["action"] as? String else { return }
        switch action {
        case "check": check()
        case "install": install()
        case "confirmInstall": confirmInstall()
        case "cancelInstall": cancelInstall()
        default: break
        }
    }
    func check() {
        guard !busy else { publish(); return }
        busy = true; release = nil; set("checking")
        let current = currentVersion
        worker.async { [weak self] in
            do {
                let data = try UpdateTransfer(maximum: 1_048_576, api: true).fetch(URL(string: "https://api.github.com/repos/\(VerifiedRelease.repository)/releases/latest")!)
                let release = try VerifiedRelease.select(data, current: current)
                DispatchQueue.main.async {
                    guard let self = self else { return }; self.busy = false; self.release = release
                    self.set(release == nil ? "idle" : "available")
                }
            } catch { DispatchQueue.main.async { self?.busy = false; self?.set("error", extra: ["error": error.localizedDescription]) } }
        }
    }
    // Ready is a save barrier, not permission to terminate. The renderer freezes
    // editing, completes a final flush, and only then sends confirmInstall.
    private func confirmInstall() {
        guard state["status"] as? String == "ready", let staged = stagedUpdate else { return }
        do {
            let process = Process(); process.executableURL = staged.helper; process.arguments = [staged.plan.path]
            process.currentDirectoryURL = staged.directory; process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            try process.run()
            stagedUpdate = nil
            set("installing"); onInstall?()
        } catch {
            try? FileManager.default.removeItem(at: staged.directory); stagedUpdate = nil
            busy = false; set("error", extra: ["error": error.localizedDescription])
        }
    }
    private func cancelInstall() {
        guard state["status"] as? String == "ready", let staged = stagedUpdate else { return }
        try? FileManager.default.removeItem(at: staged.directory); stagedUpdate = nil
        busy = false; set("error", extra: ["error": "The update is cancelled because editor changes cannot be saved. Your current app keeps running."])
    }
    func cancelPendingOnQuit() {
        if let staged = stagedUpdate { try? FileManager.default.removeItem(at: staged.directory); stagedUpdate = nil }
    }
    private func install() {
        guard !busy, let release = release else { publish(); return }
        busy = true; set("downloading", extra: ["progress": 0])
        let target = Bundle.main.bundleURL.standardizedFileURL, previous = currentVersion, resultURL = resultURL, dataDirectory = dataDirectory
        worker.async { [weak self] in
            var temporary: URL?, sibling: URL?
            do {
                try validateInstallLocation(target)
                let fm = FileManager.default
                let temp = fm.temporaryDirectory.appendingPathComponent("OpenNodes-update-\(UUID().uuidString)", isDirectory: true)
                try fm.createDirectory(at: temp, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]); temporary = temp
                let archive = temp.appendingPathComponent("release.zip")
                guard fm.createFile(atPath: archive.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw UpdateFailure("Cannot create the update download.") }
                let file = try FileHandle(forWritingTo: archive)
                do {
                    var lastProgress = -1
                    _ = try UpdateTransfer(maximum: release.asset.size, file: file) { progress in
                        let percent = Int(progress * 100)
                        guard percent != lastProgress else { return }; lastProgress = percent
                        DispatchQueue.main.async { self?.set("downloading", extra: ["progress": progress]) }
                    }.fetch(release.url)
                    try file.close()
                } catch { try? file.close(); throw error }
                let size = (try fm.attributesOfItem(atPath: archive.path)[.size] as? NSNumber)?.int64Value
                guard size == release.asset.size, try sha256File(archive) == release.sha256 else { throw UpdateFailure("The downloaded update does not match GitHub's SHA-256 digest.") }
                try validateUpdateZIP(archive)
                let extracted = temp.appendingPathComponent("extracted", isDirectory: true)
                try fm.createDirectory(at: extracted, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                _ = try runTool("/usr/bin/unzip", ["-q", archive.path, "-d", extracted.path])
                let app = extracted.appendingPathComponent("OpenNodes.app", isDirectory: true)
                try validateUpdateBundle(app, version: release.version, architecture: VerifiedRelease.architecture)
                let stage = target.deletingLastPathComponent().appendingPathComponent(".OpenNodes-update-\(UUID().uuidString)", isDirectory: true)
                try fm.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]); sibling = stage
                let candidate = stage.appendingPathComponent("OpenNodes.app", isDirectory: true)
                try fm.copyItem(at: app, to: candidate)
                try validateUpdateBundle(candidate, version: release.version, architecture: VerifiedRelease.architecture)
                let helper = stage.appendingPathComponent("OpenNodesUpdateHelper")
                // Use the running app's helper, not an executable chosen by a page.
                try fm.copyItem(at: target.appendingPathComponent("Contents/Resources/OpenNodesUpdateHelper"), to: helper)
                try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
                let plan = UpdateInstallPlan(target: target.path, stage: stage.path, version: release.version, previousVersion: previous, architecture: VerifiedRelease.architecture, parentPID: ProcessInfo.processInfo.processIdentifier, resultFile: resultURL.path, dataDirectory: dataDirectory.path)
                let planURL = stage.appendingPathComponent("plan.json")
                try JSONEncoder().encode(plan).write(to: planURL, options: .atomic)
                try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: planURL.path)
                try? fm.removeItem(at: temp); temporary = nil
                DispatchQueue.main.async {
                    guard let self = self else { try? fm.removeItem(at: stage); return }
                    self.stagedUpdate = StagedUpdate(directory: stage, helper: helper, plan: planURL)
                    self.set("ready", extra: ["progress": 1])
                }
            } catch {
                if let temporary = temporary { try? FileManager.default.removeItem(at: temporary) }
                if let sibling = sibling { try? FileManager.default.removeItem(at: sibling) }
                DispatchQueue.main.async { self?.busy = false; self?.set("error", extra: ["error": error.localizedDescription]) }
            }
        }
    }
}
