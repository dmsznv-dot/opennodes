import Foundation
import AppKit

@main
struct OpenNodesUpdateHelper {
    static func main() {
        guard CommandLine.arguments.count == 2 else { exit(2) }
        let planURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
        guard let data = try? Data(contentsOf: planURL), data.count <= 16_384,
              let plan = try? JSONDecoder().decode(UpdateInstallPlan.self, from: data) else { exit(2) }
        let stage = URL(fileURLWithPath: plan.stage).standardizedFileURL
        let target = URL(fileURLWithPath: plan.target).standardizedFileURL
        let fm = FileManager.default
        let backup = target.deletingLastPathComponent().appendingPathComponent(".OpenNodes-backup-\(UUID().uuidString).app")
        let result = URL(fileURLWithPath: plan.resultFile)
        func report(_ object: [String: String]) { try? JSONSerialization.data(withJSONObject: object).write(to: result, options: .atomic) }
        do {
            guard getuid() != 0, plan.parentPID > 1, plan.parentPID != getpid(),
                  planURL.deletingLastPathComponent() == stage,
                  stage.deletingLastPathComponent() == target.deletingLastPathComponent(),
                  stage.lastPathComponent.hasPrefix(".OpenNodes-update-"),
                  stage == stage.resolvingSymlinksInPath(),
                  (try fm.attributesOfItem(atPath: stage.path)[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
                  plan.architecture == VerifiedRelease.architecture, let old = ReleaseVersion(plan.previousVersion), let next = ReleaseVersion(plan.version), next > old else { throw UpdateFailure("The update installation plan is invalid.") }
            let candidate = stage.appendingPathComponent("OpenNodes.app")
            try validateInstallLocation(target)
            try validateUpdateBundle(candidate, version: plan.version, architecture: plan.architecture)
            try validateUpdateBundle(target, version: plan.previousVersion, architecture: plan.architecture)
            // Wait for the application to stop its local engine and exit. Never swap
            // while the old process is running, and never force-quit it here.
            var waited = 0
            while kill(plan.parentPID, 0) == 0 || errno == EPERM {
                guard waited < 1200 else { throw UpdateFailure("OpenNodes does not exit in time. The update is cancelled; reopen the app and retry.") }
                Thread.sleep(forTimeInterval: 0.1); waited += 1
            }
            try validateInstallLocation(target)
            try replaceUpdateBundle(target: target, staged: candidate, backup: backup, validate: { url in
                try validateUpdateBundle(url, version: plan.version, architecture: plan.architecture)
            }, reopen: { url in
                if Bundle(url: url)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == plan.version {
                    report(["version": plan.version, "backup": backup.path])
                } else {
                    report(["error": "The update cannot start. The previous version is restored."])
                }
                _ = try runTool("/usr/bin/open", ["-n", url.path, "--args", "--data-dir=\(plan.dataDirectory)"])
            })
            try? fm.removeItem(at: stage)
        } catch {
            report(["error": error.localizedDescription])
            // Preserve a backup if recovery itself fails. Stage is private and bounded.
            if fm.fileExists(atPath: target.path) {
                _ = try? runTool("/usr/bin/open", ["-n", target.path, "--args", "--data-dir=\(plan.dataDirectory)"])
                try? fm.removeItem(at: stage)
            }
            exit(1)
        }
    }
}
