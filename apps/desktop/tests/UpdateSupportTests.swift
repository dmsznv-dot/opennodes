import Foundation

@main
struct UpdateSupportTests {
    static var checks = 0
    static func expect(_ condition: Bool, _ message: String) {
        checks += 1; guard condition else { fatalError(message) }
    }
    static func rejects(_ message: String, _ block: () throws -> Void) {
        checks += 1; do { try block(); fatalError("Expected rejection: \(message)") } catch { }
    }
    static func manifest(version: String = "v0.4.0", draft: Bool = false, prerelease: Bool = false, hash: String? = "sha256:" + String(repeating: "a", count: 64), url: String? = nil, name: String = "OpenNodes-macOS-arm64.zip", size: Int64 = 42) throws -> Data {
        var asset: [String: Any] = ["name": name, "size": size, "browser_download_url": url ?? "https://github.com/dmsznv-dot/opennodes/releases/download/\(version)/\(name)"]
        if let hash = hash { asset["digest"] = hash }
        return try JSONSerialization.data(withJSONObject: ["tag_name": version, "draft": draft, "prerelease": prerelease, "body": "Release notes", "assets": [asset]])
    }
    static func zip(_ entries: [(String, String, Int)], at url: URL) throws {
        var local = Data(), central = Data()
        func word(_ value: Int, _ count: Int) -> Data { Data((0..<count).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) }) }
        for (name, content, kind) in entries {
            let n = Data(name.utf8), c = Data(content.utf8), offset = local.count
            var crc: UInt32 = 0xffffffff
            for byte in c { crc ^= UInt32(byte); for _ in 0..<8 { crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb88320 : 0) } }
            let checksum = Int(crc ^ 0xffffffff)
            local.append(word(0x04034b50, 4)); for v in [20,0,0,0,0] { local.append(word(v,2)) }
            for v in [checksum,c.count,c.count] { local.append(word(v,4)) }
            local.append(word(n.count,2)); local.append(word(0,2)); local.append(n); local.append(c)
            central.append(word(0x02014b50,4)); for v in [0x0314,20,0,0,0,0] { central.append(word(v,2)) }
            for v in [checksum,c.count,c.count] { central.append(word(v,4)) }
            for v in [n.count,0,0,0,0] { central.append(word(v,2)) }
            central.append(word(kind << 16,4)); central.append(word(offset,4)); central.append(n)
        }
        var archive = local; archive.append(central); archive.append(word(0x06054b50,4))
        for v in [0,0,entries.count,entries.count] { archive.append(word(v,2)) }
        archive.append(word(central.count,4)); archive.append(word(local.count,4)); archive.append(word(0,2))
        try archive.write(to: url)
    }
    static func main() throws {
        expect(ReleaseVersion("0.10.0")! > ReleaseVersion("0.9.99")!, "numeric version ordering")
        expect(ReleaseVersion("1.0.0")! > ReleaseVersion("0.99.99")!, "major ordering")
        for bad in ["01.2.3", "1.02.3", "1.2", "v1.2.3", "1.2.3-beta", "1.2.3+meta", "-1.2.3", "1..3", "18446744073709551616.0.0"] { expect(ReleaseVersion(bad) == nil, "reject invalid semver \(bad)") }
        let good = try VerifiedRelease.select(manifest(), current: "0.3.0", architecture: "arm64")
        expect(good?.version == "0.4.0", "matching asset selection"); expect(good?.notes == "Release notes", "release notes")
        expect(try VerifiedRelease.select(manifest(version: "v0.3.0"), current: "0.3.0", architecture: "arm64") == nil, "no reinstall")
        expect(try VerifiedRelease.select(manifest(version: "v0.2.0"), current: "0.3.0", architecture: "arm64") == nil, "no downgrade")
        expect(try VerifiedRelease.select(manifest(draft: true), current: "0.3.0", architecture: "arm64") == nil, "ignore draft")
        expect(try VerifiedRelease.select(manifest(prerelease: true), current: "0.3.0", architecture: "arm64") == nil, "ignore prerelease")
        rejects("no digest") { _ = try VerifiedRelease.select(manifest(hash: nil), current: "0.3.0", architecture: "arm64") }
        rejects("invalid digest") { _ = try VerifiedRelease.select(manifest(hash: "sha256:abcd"), current: "0.3.0", architecture: "arm64") }
        rejects("wrong architecture") { _ = try VerifiedRelease.select(manifest(), current: "0.3.0", architecture: "x64") }
        rejects("oversized asset") { _ = try VerifiedRelease.select(manifest(size: VerifiedRelease.maximumArchive + 1), current: "0.3.0", architecture: "arm64") }
        for url in ["http://github.com/dmsznv-dot/opennodes/releases/download/v0.4.0/OpenNodes-macOS-arm64.zip", "https://github.com/attacker/opennodes/releases/download/v0.4.0/OpenNodes-macOS-arm64.zip", "https://example.com/update.zip", "https://github.com/dmsznv-dot/opennodes/releases/download/v0.4.0/OpenNodes-macOS-arm64.zip?redirect=evil"] {
            rejects("untrusted URL") { _ = try VerifiedRelease.select(manifest(url: url), current: "0.3.0", architecture: "arm64") }
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("OpenNodes-updater-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let archive = root.appendingPathComponent("test.zip")
        try zip([("OpenNodes.app/file", "test", 0x8000)], at: archive); try validateUpdateZIP(archive); checks += 1
        try zip([("OpenNodes.app/../escape", "test", 0x8000)], at: archive); rejects("zip traversal") { try validateUpdateZIP(archive) }
        try zip([("OpenNodes.app/link", "../../escape", 0xa000)], at: archive); rejects("symlink escape") { try validateUpdateZIP(archive) }
        try zip([("OpenNodes.app/link", "inside", 0xa000), ("OpenNodes.app/link/file", "bad", 0x8000)], at: archive); rejects("write through symlink") { try validateUpdateZIP(archive) }
        try zip([("OpenNodes.app/link", "inside", 0xa000), ("OpenNodes.app/inside", "good", 0x8000)], at: archive); try validateUpdateZIP(archive); checks += 1
        try zip([("OpenNodes.app/file", "a", 0x8000), ("OpenNodes.app/FILE", "b", 0x8000)], at: archive); rejects("case-insensitive duplicate") { try validateUpdateZIP(archive) }
        let target = root.appendingPathComponent("OpenNodes.app"), staged = root.appendingPathComponent("candidate.app"), backup = root.appendingPathComponent("backup.app")
        try Data("old".utf8).write(to: target); try Data("new".utf8).write(to: staged)
        var launches = 0
        rejects("relaunch failure rolls back") {
            try replaceUpdateBundle(target: target, staged: staged, backup: backup, validate: { _ in }, reopen: { _ in
                launches += 1; if launches == 1 { throw UpdateFailure("simulated launch failure") }
            })
        }
        expect(try String(contentsOf: target, encoding: .utf8) == "old", "old app restored")
        expect(try String(contentsOf: staged, encoding: .utf8) == "new", "new app retained in stage")
        expect(!FileManager.default.fileExists(atPath: backup.path), "no stray backup after rollback"); expect(launches == 2, "old app reopened")
        try replaceUpdateBundle(target: target, staged: staged, backup: backup, validate: { _ in }, reopen: { _ in })
        expect(try String(contentsOf: target, encoding: .utf8) == "new", "successful replacement")
        expect(try String(contentsOf: backup, encoding: .utf8) == "old", "successful replacement preserves backup")
        let hash = root.appendingPathComponent("hash"); try Data("abc".utf8).write(to: hash)
        expect(try sha256File(hash) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "streamed SHA-256")
        print("\(checks) updater checks passed")
    }
}
