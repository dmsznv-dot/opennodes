import AppKit
import WebKit

private let russian = Locale.preferredLanguages.first?.hasPrefix("ru") == true
private func text(_ ru: String, _ en: String) -> String { russian ? ru : en }

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var overlay: NSStackView!
    private var message: NSTextField!
    private var progress: NSProgressIndicator!
    private var retryButton: NSButton!
    private var child: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var logHandle: FileHandle?
    private var pending = Data()
    private var origin: URL?
    private var deadline: DispatchWorkItem?
    private var quitting = false
    private var repliedToQuit = false
    private let dataURL: URL = {
        // Used by development/QA so launching a test build never touches a real install.
        if let argument = CommandLine.arguments.first(where: { $0.hasPrefix("--data-dir=") }) {
            return URL(fileURLWithPath: String(argument.dropFirst("--data-dir=".count)), isDirectory: true)
        }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OpenNodes", isDirectory: true)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenus()
        buildWindow()
        buildStatusItem()
        showWindow()
        startRuntime()
    }

    private func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 880),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "OpenNodes"
        window.minSize = NSSize(width: 820, height: 580)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("OpenNodes.MainWindow")
        window.center()
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window.contentView = root

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: root.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 72).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 72).isActive = true
        let title = NSTextField(labelWithString: "OpenNodes")
        title.font = .systemFont(ofSize: 24, weight: .semibold)
        message = NSTextField(wrappingLabelWithString: "")
        message.alignment = .center
        message.textColor = .secondaryLabelColor
        message.preferredMaxLayoutWidth = 400
        progress = NSProgressIndicator()
        progress.style = .spinning
        progress.controlSize = .small
        retryButton = NSButton(title: text("Повторить запуск", "Try again"), target: self, action: #selector(retry))
        overlay = NSStackView(views: [icon, title, message, progress, retryButton])
        overlay.orientation = .vertical
        overlay.spacing = 18
        overlay.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            overlay.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            overlay.widthAnchor.constraint(lessThanOrEqualToConstant: 440)
        ])
    }

    private func item(_ title: String, _ action: Selector?, _ key: String = "") -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key)
        result.target = self
        return result
    }

    private func buildMenus() {
        let bar = NSMenu()
        let application = NSMenu()
        application.addItem(item(text("Об OpenNodes", "About OpenNodes"), #selector(about)))
        application.addItem(.separator())
        application.addItem(item(text("Открыть папку данных…", "Open data folder…"), #selector(openData)))
        application.addItem(item(text("Открыть журнал…", "Open log…"), #selector(openLog)))
        application.addItem(.separator())
        let hide = NSMenuItem(title: text("Скрыть OpenNodes", "Hide OpenNodes"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        application.addItem(hide)
        application.addItem(item(text("Завершить OpenNodes", "Quit OpenNodes"), #selector(quit), "q"))
        let appItem = NSMenuItem(); appItem.submenu = application; bar.addItem(appItem)

        let edit = NSMenu(title: text("Правка", "Edit"))
        for (name, selector, key) in [
            (text("Отменить", "Undo"), "undo:", "z"),
            (text("Вернуть", "Redo"), "redo:", "Z"),
            (text("Вырезать", "Cut"), "cut:", "x"),
            (text("Копировать", "Copy"), "copy:", "c"),
            (text("Вставить", "Paste"), "paste:", "v"),
            (text("Выбрать всё", "Select All"), "selectAll:", "a")
        ] { edit.addItem(NSMenuItem(title: name, action: Selector(selector), keyEquivalent: key)) }
        let editItem = NSMenuItem(); editItem.submenu = edit; bar.addItem(editItem)

        let view = NSMenu(title: text("Вид", "View"))
        view.addItem(item(text("Обновить редактор", "Reload editor"), #selector(reload), "r"))
        view.addItem(item(text("Открыть в браузере", "Open in browser"), #selector(openBrowser)))
        let viewItem = NSMenuItem(); viewItem.submenu = view; bar.addItem(viewItem)

        let windows = NSMenu(title: text("Окно", "Window"))
        windows.addItem(item(text("Открыть OpenNodes", "Show OpenNodes"), #selector(showWindow), "1"))
        let close = NSMenuItem(title: text("Закрыть окно", "Close Window"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windows.addItem(close)
        let windowItem = NSMenuItem(); windowItem.submenu = windows; bar.addItem(windowItem)
        NSApp.windowsMenu = windows
        NSApp.mainMenu = bar
    }

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "OpenNodes")
        statusItem.button?.toolTip = "OpenNodes"
        let menu = NSMenu()
        menu.addItem(item(text("Открыть OpenNodes", "Open OpenNodes"), #selector(showWindow)))
        let note = NSMenuItem(title: text("Сценарии работают при закрытом окне", "Automations run with the window closed"), action: nil, keyEquivalent: "")
        note.isEnabled = false; menu.addItem(note)
        menu.addItem(.separator())
        menu.addItem(item(text("Завершить OpenNodes", "Quit OpenNodes"), #selector(quit)))
        statusItem.menu = menu
    }

    private func startRuntime() {
        guard child == nil else { return }
        origin = nil
        pending.removeAll()
        webView.isHidden = true
        overlay.isHidden = false
        retryButton.isHidden = true
        message.stringValue = text("Запускаю локальный движок и базу данных…", "Starting the local engine and database…")
        progress.isHidden = false
        progress.startAnimation(nil)
        guard let resources = Bundle.main.resourceURL else { showFailure(); return }
        let node = resources.appendingPathComponent("node")
        let entry = resources.appendingPathComponent("runtime/runtime/desktop-server.mjs")
        do {
            try FileManager.default.createDirectory(at: dataURL, withIntermediateDirectories: true)
            let logURL = dataURL.appendingPathComponent("desktop.log")
            // Rotate a large log, keeping startup diagnostics bounded on disk.
            if let size = try? logURL.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 2_000_000 {
                let previous = dataURL.appendingPathComponent("desktop.previous.log")
                try? FileManager.default.removeItem(at: previous)
                try? FileManager.default.moveItem(at: logURL, to: previous)
            }
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            logHandle = try FileHandle(forWritingTo: logURL)
            try logHandle?.seekToEnd()
            let process = Process()
            process.executableURL = node
            process.arguments = [entry.path]
            var environment = ProcessInfo.processInfo.environment
            environment["OPENNODES_DESKTOP_PARENT"] = "1"
            environment["OPENNODES_DATA_DIR"] = dataURL.path
            environment["OPENNODES_WEB_ROOT"] = resources.appendingPathComponent("editor").path
            // Environment hooks that alter Node execution must not affect a packaged app.
            environment.removeValue(forKey: "NODE_OPTIONS")
            environment.removeValue(forKey: "NODE_PATH")
            process.environment = environment
            process.currentDirectoryURL = dataURL
            let stdin = Pipe(); input = stdin; process.standardInput = stdin
            let stdout = Pipe(); output = stdout; process.standardOutput = stdout
            process.standardError = logHandle
            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let bytes = handle.availableData
                guard !bytes.isEmpty else { return }
                DispatchQueue.main.async { self?.receive(bytes) }
            }
            process.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async { self?.runtimeStopped() }
            }
            child = process
            try process.run()
            let timeout = DispatchWorkItem { [weak self] in
                guard let self = self, self.origin == nil else { return }
                self.child?.terminate()
                self.showFailure()
            }
            deadline = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
        } catch {
            child = nil
            showFailure()
        }
    }

    private func receive(_ bytes: Data) {
        pending.append(bytes)
        // Runtime stdout is NDJSON; a split read must not drop part of the URL.
        while let end = pending.firstIndex(of: 10) {
            let line = pending.subdata(in: pending.startIndex..<end)
            pending.removeSubrange(pending.startIndex...end)
            guard let event = try? JSONSerialization.jsonObject(with: line) as? [String: String],
                  event["event"] == "ready", let address = event["url"], let url = URL(string: address),
                  url.scheme == "http", url.host == "127.0.0.1", let port = url.port, port > 0 else { continue }
            guard !quitting else { continue }
            origin = url
            deadline?.cancel()
            message.stringValue = text("Открываю редактор…", "Opening the editor…")
            webView.load(URLRequest(url: url))
        }
        if pending.count > 1_000_000 { pending.removeAll() }
    }

    private func showFailure() {
        deadline?.cancel()
        webView.isHidden = true
        overlay.isHidden = false
        progress.stopAnimation(nil)
        progress.isHidden = true
        message.stringValue = text("Не удаётся открыть локальный движок. Подробности — в меню OpenNodes → Открыть журнал.", "The local engine cannot start. Details are in OpenNodes → Open log.")
        retryButton.isHidden = false
    }

    private func runtimeStopped() {
        deadline?.cancel()
        output?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close()
        try? logHandle?.close()
        child = nil; input = nil; output = nil; logHandle = nil
        if quitting {
            if !repliedToQuit { repliedToQuit = true; NSApp.reply(toApplicationShouldTerminate: true) }
        } else { showFailure() }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let child = child, child.isRunning else { return .terminateNow }
        if quitting { return .terminateLater }
        quitting = true
        deadline?.cancel()
        try? input?.fileHandleForWriting.close()
        child.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard let self = self, !self.repliedToQuit else { return }
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    @objc private func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func retry() { if child == nil { startRuntime() } }
    @objc private func reload() { if origin != nil { webView.reload() } else { retry() } }
    @objc private func openData() { NSWorkspace.shared.open(dataURL) }
    @objc private func openLog() { NSWorkspace.shared.open(dataURL.appendingPathComponent("desktop.log")) }
    @objc private func openBrowser() { if let url = origin { NSWorkspace.shared.open(url) } }
    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "OpenNodes", .applicationVersion: "0.2.0 · macOS alpha",
            .credits: NSAttributedString(string: text("Локальные автоматизации. Данные хранятся на этом компьютере.\nЗакрытие окна сохраняет работу сценариев. Выход останавливает движок.", "Local automations. Data stays on this computer.\nClosing the window keeps automations running. Quit stops the engine."))
        ])
    }

    private func sameOrigin(_ url: URL) -> Bool {
        guard let origin = origin else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if sameOrigin(url) || (url.scheme == "blob" && action.shouldPerformDownload) {
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
        } else {
            if action.navigationType == .linkActivated && ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        overlay.isHidden = true
        progress.stopAnimation(nil)
        webView.isHidden = false
        window.makeFirstResponder(webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showFailure() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if sameOrigin(url) { webView.load(action.request) }
            else if action.navigationType == .linkActivated && ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
