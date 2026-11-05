import Foundation
import CryptoKit
import Security

struct UpdateFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct ReleaseVersion: Comparable, Equatable {
    let major: UInt64
    let minor: UInt64
    let patch: UInt64
    let string: String
    init?(_ input: String) {
        // Stable releases only. Leading zeroes, prefixes, prerelease and build suffixes
        // are rejected rather than compared ambiguously.
        let parts = input.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && ($0 == "0" || !$0.hasPrefix("0")) && $0.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) }),
              let a = UInt64(parts[0]), let b = UInt64(parts[1]), let c = UInt64(parts[2]) else { return nil }
        major = a; minor = b; patch = c; string = input
    }
    static func < (a: Self, b: Self) -> Bool {
        if a.major != b.major { return a.major < b.major }
        if a.minor != b.minor { return a.minor < b.minor }
        return a.patch < b.patch
    }
}

struct GitHubRelease: Decodable {
    struct Asset: Decodable {
        let name: String
        let size: Int64
        let browser_download_url: String
        let digest: String?
    }
    let tag_name: String
    let draft: Bool
    let prerelease: Bool
    let body: String?
    let assets: [Asset]
}
struct VerifiedRelease {
    let version: String
    let notes: String
    let asset: GitHubRelease.Asset
    let url: URL
    let sha256: String
    static let repository = "dmsznv-dot/opennodes"
    static let maximumArchive: Int64 = 1_500_000_000
    static var architecture: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }
    static func select(_ data: Data, current: String, architecture: String = architecture) throws -> Self? {
        let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
        guard !release.draft, !release.prerelease else { return nil }
        let tag = release.tag_name.hasPrefix("v") ? String(release.tag_name.dropFirst()) : release.tag_name
        guard let next = ReleaseVersion(tag), let installed = ReleaseVersion(current) else {
            throw UpdateFailure("The release has an invalid stable version.")
        }
        guard next > installed else { return nil }
        let name = "OpenNodes-macOS-\(architecture).zip"
        let matches = release.assets.filter { $0.name == name }
        guard matches.count == 1, let asset = matches.first,
              asset.size > 0, asset.size <= maximumArchive else {
            throw UpdateFailure("This release has no valid macOS archive for this Mac.")
        }
        guard let digest = asset.digest, digest.hasPrefix("sha256:") else { throw UpdateFailure("GitHub does not provide the required SHA-256 digest for this release.") }
        let hash = String(digest.dropFirst(7))
        guard hash.count == 64, hash.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }) else { throw UpdateFailure("The release SHA-256 digest is invalid.") }
        guard let url = URL(string: asset.browser_download_url), url.scheme == "https", url.host == "github.com", url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil,
              url.path == "/\(repository)/releases/download/\(release.tag_name)/\(name)" else { throw UpdateFailure("The release download address is invalid.") }
        return Self(version: tag, notes: String((release.body ?? "").prefix(20_000)), asset: asset, url: url, sha256: hash)
    }
}

func runTool(_ executable: String, _ arguments: [String], maximumOutput: Int = 1_000_000) throws -> Data {
    let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
    let pipe = Pipe(); process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
    try process.run()
    var output = Data()
    while true {
        let bytes = pipe.fileHandleForReading.readData(ofLength: 64 * 1024)
        if bytes.isEmpty { break }
        output.append(bytes)
        if output.count > maximumOutput { process.terminate(); process.waitUntilExit(); throw UpdateFailure("Update validation output exceeds its limit.") }
    }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw UpdateFailure("Update validation failed (\(URL(fileURLWithPath: executable).lastPathComponent)).") }
    return output
}

func sha256File(_ url: URL) throws -> String {
    let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
    var hash = SHA256()
    while let data = try file.read(upToCount: 1_048_576), !data.isEmpty { hash.update(data: data) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
}

// Validate central and local ZIP names before extraction. An archive cannot write
// through a symlink. Internal package links are permitted, external links are not.
func validateUpdateZIP(_ url: URL) throws {
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    func u16(_ p: Int) -> Int { Int(data[p]) | Int(data[p+1]) << 8 }
    func u32(_ p: Int) -> Int { u16(p) | u16(p+2) << 16 }
    guard data.count >= 22 else { throw UpdateFailure("The update archive is truncated.") }
    var footer: Int?
    for p in stride(from: data.count - 22, through: max(0, data.count - 65_557), by: -1) {
        if u32(p) == 0x06054b50 && p + 22 + u16(p+20) == data.count { footer = p; break }
    }
    guard let end = footer, u16(end+4) == 0, u16(end+6) == 0, u16(end+8) == u16(end+10),
          u16(end+10) > 0, u16(end+10) < 65_535 else { throw UpdateFailure("Unsupported update ZIP layout.") }
    let centralEnd = u32(end+16) + u32(end+12)
    guard centralEnd == end else { throw UpdateFailure("Invalid update ZIP directory.") }
    var cursor = u32(end+16), names = Set<String>(), links = [String](), expanded: Int64 = 0
    for _ in 0..<u16(end+10) {
        guard cursor >= 0, cursor + 46 <= end, u32(cursor) == 0x02014b50 else { throw UpdateFailure("Invalid ZIP entry.") }
        let count = u16(cursor+28), extra = u16(cursor+30), comment = u16(cursor+32), flags = u16(cursor+8), method = u16(cursor+10)
        let size = u32(cursor+24), compressed = u32(cursor+20), local = u32(cursor+42)
        guard cursor + 46 + count + extra + comment <= end, flags & 1 == 0, [0,8].contains(method),
              let name = String(data: data.subdata(in: cursor+46..<cursor+46+count), encoding: .utf8),
              !name.contains("\\"), !name.contains("\0"), !name.contains("\n"), !name.hasPrefix("/"),
              name == name.precomposedStringWithCanonicalMapping,
              name.split(separator: "/", omittingEmptySubsequences: false).enumerated().allSatisfy({ index, p in ![".", ".."].contains(String(p)) && (!p.isEmpty || index == name.split(separator: "/", omittingEmptySubsequences: false).count - 1) }),
              name == "OpenNodes.app/" || name.hasPrefix("OpenNodes.app/") || name.hasPrefix("__MACOSX/"),
              names.insert(name.lowercased()).inserted else { throw UpdateFailure("Unsafe or duplicate update ZIP path.") }
        guard local >= 0, local + 30 <= u32(end+16), u32(local) == 0x04034b50, u16(local+6) == flags, u16(local+8) == method,
              u16(local+26) == count, local + 30 + count + u16(local+28) + compressed <= u32(end+16),
              data.subdata(in: local+30..<local+30+count) == data.subdata(in: cursor+46..<cursor+46+count) else { throw UpdateFailure("ZIP local entry does not match its directory.") }
        expanded += Int64(size)
        guard expanded <= 5_000_000_000 else { throw UpdateFailure("The unpacked update exceeds its size limit.") }
        let kind = (u32(cursor+38) >> 16) & 0xf000
        guard [0,0x4000,0x8000,0xa000].contains(kind) else { throw UpdateFailure("Unsupported ZIP file type.") }
        if kind == 0xa000 {
            guard name.hasPrefix("OpenNodes.app/"), size > 0, size <= 4096 else { throw UpdateFailure("Invalid update symlink.") }
            links.append(name)
        }
        cursor += 46 + count + extra + comment
    }
    guard cursor == end else { throw UpdateFailure("Invalid ZIP directory length.") }
    for link in links {
        guard !names.contains(where: { $0.hasPrefix(link.lowercased() + "/") }) else { throw UpdateFailure("Update ZIP writes through a symlink.") }
        let bytes = try runTool("/usr/bin/unzip", ["-p", url.path, link], maximumOutput: 4096)
        guard let target = String(data: bytes, encoding: .utf8), !target.isEmpty, !target.hasPrefix("/"), !target.contains("\0"), !target.contains("\\") else { throw UpdateFailure("Invalid update symlink destination.") }
        let destination = URL(fileURLWithPath: "/archive/" + link).deletingLastPathComponent().appendingPathComponent(target).standardizedFileURL.path
        guard destination.hasPrefix("/archive/OpenNodes.app/") else { throw UpdateFailure("Update symlink escapes the application.") }
    }
}

// A Bundle instance can keep the old Info.plist cached after a replacement at the same path.
func readUpdateBundleInfo(_ app: URL) throws -> [String: Any] {
    let info = app.appendingPathComponent("Contents/Info.plist")
    let data = try Data(contentsOf: info)
    guard let plist = try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any] else {
        throw UpdateFailure("The update application metadata is invalid.")
    }
    return plist
}

func validateUpdateBundle(_ app: URL, version: String, architecture: String) throws {
    let fm = FileManager.default
    let resolved = app.resolvingSymlinksInPath().standardizedFileURL
    guard resolved == app.standardizedFileURL else { throw UpdateFailure("The update application path is invalid.") }
    let info = try readUpdateBundleInfo(app)
    guard info["CFBundleIdentifier"] as? String == "app.opennodes.desktop",
          info["CFBundleShortVersionString"] as? String == version,
          info["CFBundleExecutable"] as? String == "OpenNodes" else { throw UpdateFailure("The update is not the expected OpenNodes application.") }
    guard let enumerator = fm.enumerator(at: app, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { throw UpdateFailure("The update bundle cannot be read.") }
    for case let item as URL in enumerator {
        let actual = item.resolvingSymlinksInPath().standardizedFileURL.path
        guard actual.hasPrefix(app.path + "/") else { throw UpdateFailure("An update bundle link escapes the application.") }
    }
    let expected = architecture == "arm64" ? "arm64" : "x86_64"
    for path in ["Contents/MacOS/OpenNodes", "Contents/Resources/node", "Contents/Resources/OpenNodesUpdateHelper"] {
        let arches = String(data: try runTool("/usr/bin/lipo", ["-archs", app.appendingPathComponent(path).path]), encoding: .utf8) ?? ""
        guard arches.split(whereSeparator: { $0.isWhitespace }).contains(Substring(expected)) else { throw UpdateFailure("The update is built for a different Mac architecture.") }
    }
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(app as CFURL, SecCSFlags(), &code) == errSecSuccess, let code = code,
          SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode), nil) == errSecSuccess else { throw UpdateFailure("The update code signature is invalid.") }
    // Ad-hoc signatures provide integrity, not publisher identity. Trust originates
    // from the fixed GitHub repository over HTTPS plus its release-asset digest.
}

struct UpdateInstallPlan: Codable {
    let target: String
    let stage: String
    let version: String
    let previousVersion: String
    let architecture: String
    let parentPID: Int32
    let resultFile: String
    let dataDirectory: String
}

func validateInstallLocation(_ target: URL) throws {
    let fm = FileManager.default, parent = target.deletingLastPathComponent()
    guard target.pathExtension == "app", target == target.resolvingSymlinksInPath().standardizedFileURL,
          !target.path.contains("/AppTranslocation/"), !target.path.hasPrefix("/Volumes/"),
          fm.isWritableFile(atPath: target.path), fm.isWritableFile(atPath: parent.path),
          (try fm.attributesOfItem(atPath: target.path)[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else {
        throw UpdateFailure("Move OpenNodes to a writable Applications folder, then reopen it before updating.")
    }
}

// Both renames happen on the destination volume. Failure restores the old bundle;
// the backup is kept after success until the next launch verifies the new app.
func replaceUpdateBundle(target: URL, staged: URL, backup: URL, validate: (URL) throws -> Void, reopen: (URL) throws -> Void) throws {
    let fm = FileManager.default
    guard !fm.fileExists(atPath: backup.path) else { throw UpdateFailure("An update backup already exists.") }
    try validate(staged)
    try fm.moveItem(at: target, to: backup)
    do {
        try fm.moveItem(at: staged, to: target)
        try validate(target)
        try reopen(target)
    } catch {
        if fm.fileExists(atPath: target.path) { try? fm.moveItem(at: target, to: staged) }
        do { try fm.moveItem(at: backup, to: target) }
        catch { throw UpdateFailure("Update recovery needs attention. Your previous app is preserved at \(backup.path).") }
        try? reopen(target)
        throw error
    }
}
